import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { neon } from '@neondatabase/serverless';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import * as schema from '../shared/schema.js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import path from 'path';
import * as fs from 'fs';

// Используем PostgreSQL базу данных
console.log('Using PostgreSQL database');

// Определяем, запущено ли приложение на Render.com
const IS_RENDER = process.env.RENDER === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Получаем DATABASE_URL из переменных окружения  
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// Проверяем что DATABASE_URL не undefined
const databaseUrl: string = DATABASE_URL;
console.log('✅ Используем основной DATABASE_URL для подключения');
console.log('📡 Database host:', databaseUrl.includes('supabase.com') ? 'Supabase' : databaseUrl.includes('neon.tech') ? 'Neon' : 'Other PostgreSQL');

console.log('Connecting to PostgreSQL database...');

// ИСПРАВЛЕНО: Используем обычный postgres клиент для Supabase
// Neon serverless предназначен только для Neon Database
console.log('✅ Используем стандартный PostgreSQL клиент для Supabase с connection pooling');

// ИСПРАВЛЕНИЕ: Добавляем правильную конфигурацию connection pooling для Vercel/Serverless
const sql = postgres(databaseUrl, { 
  ssl: 'require',
  max: 1,                    // Максимум 1 подключение в serverless окружении
  idle_timeout: 5,           // Уменьшаем idle timeout до 5 секунд
  connect_timeout: 30,       // Увеличиваем connect timeout до 30 секунд
  prepare: false,            // Отключаем prepared statements для serverless
  connection: {
    application_name: 'ooo-bnal-bank',
    options: '--search_path=public'
  },
  transform: undefined,       // Отключаем трансформации для лучшей производительности
  fetch_types: false         // Отключаем fetch types для serverless окружения
});

const db = drizzle(sql, { schema });
const client = sql; // Для совместимости

// Добавляем обработчик для graceful shutdown
const gracefulShutdown = () => {
  console.log('🔄 Graceful shutdown initiated, closing database connections...');
  sql.end({ timeout: 5 }).catch(console.error);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Добавляем функцию-помощник для безопасных операций с timeout
export async function withDatabaseTimeout<T>(
  operation: Promise<T>, 
  timeoutMs: number = 50000, // УВЕЛИЧИЛИ до 50 секунд для Vercel
  operationName: string = 'Database operation'
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  
  try {
    console.log(`🔄 [VERCEL] Начинаем ${operationName} с таймаутом ${timeoutMs}ms`);
    const result = await Promise.race([operation, timeoutPromise]);
    console.log(`✅ [VERCEL] ${operationName} завершена успешно`);
    return result;
  } catch (error) {
    console.error(`❌ [VERCEL] ${operationName} failed:`, error);
    
    // Если это ошибка подключения, пробуем переподключиться
    if (error instanceof Error && (
      error.message.includes('CONNECT_TIMEOUT') ||
      error.message.includes('connection') ||
      error.message.includes('timeout')
    )) {
      console.log('🔄 Attempting to reconnect to database...');
      // Даем базе немного времени на восстановление
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw error;
  }
}

// Экспортируем клиенты
export { client, db };

// Создаем таблицы в PostgreSQL базе данных
async function createTablesIfNotExist() {
  try {
    console.log('Checking and creating database tables if needed...');
    
    // Используем обычный postgres клиент с короткими таймаутами для каждой операции
    const executeSQL = async (query: string) => {
      return await withDatabaseTimeout(
        client.unsafe(query),
        10000,
        'Create table query'
      );
    };
    
    // Создаем основные таблицы по очереди, но быстро
    console.log('Creating users table...');
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        is_regulator BOOLEAN NOT NULL DEFAULT false,
        regulator_balance TEXT NOT NULL DEFAULT '0',
        last_nft_generation TIMESTAMP,
        nft_generation_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    
    console.log('Creating cards table...');
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS cards (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        number TEXT NOT NULL,
        expiry TEXT NOT NULL,
        cvv TEXT NOT NULL,
        balance TEXT NOT NULL DEFAULT '0',
        btc_balance TEXT NOT NULL DEFAULT '0',
        eth_balance TEXT NOT NULL DEFAULT '0',
        kichcoin_balance TEXT NOT NULL DEFAULT '0',
        btc_address TEXT,
        eth_address TEXT,
        ton_address TEXT
      )
    `);
    
    console.log('Creating other essential tables...');
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        from_card_id INTEGER NOT NULL,
        to_card_id INTEGER,
        amount TEXT NOT NULL,
        converted_amount TEXT NOT NULL,
        type TEXT NOT NULL,
        wallet TEXT,
        status TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        description TEXT NOT NULL DEFAULT '',
        from_card_number TEXT NOT NULL,
        to_card_number TEXT
      )
    `);
    
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS exchange_rates (
        id SERIAL PRIMARY KEY,
        usd_to_uah TEXT NOT NULL,
        btc_to_usd TEXT NOT NULL,
        eth_to_usd TEXT NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    // Создаем остальные таблицы в фоне (не блокируем запуск)
    setTimeout(async () => {
      try {
        console.log('Creating NFT tables in background...');
        
        await executeSQL(`
          CREATE TABLE IF NOT EXISTS nft_collections (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            cover_image TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT NOW()
          )
        `);

        await executeSQL(`
          CREATE TABLE IF NOT EXISTS nfts (
            id SERIAL PRIMARY KEY,
            collection_id INTEGER NOT NULL,
            owner_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            image_path TEXT NOT NULL,
            attributes JSONB,
            rarity TEXT NOT NULL DEFAULT 'common',
            price TEXT DEFAULT '0',
            for_sale BOOLEAN NOT NULL DEFAULT false,
            minted_at TIMESTAMP NOT NULL DEFAULT NOW(),
            token_id TEXT NOT NULL,
            original_image_path TEXT,
            sort_order INTEGER
          )
        `);
        
        console.log('✅ NFT tables created successfully in background');
      } catch (error) {
        console.log('⚠️ NFT tables creation failed (background):', error);
      }
    }, 2000);
    
    console.log('✅ Essential database tables created successfully');
    return true;
  } catch (error) {
    console.error('❌ Error creating essential tables:', error);
    throw error;
  }
}

// Test database connection and log content
async function logDatabaseContent() {
  try {
    console.log('Testing database connection...');
    
    // Проверяем наличие таблиц и пользователей
    let usersResult: schema.User[] = [];
    try {
      usersResult = await db.select().from(schema.users);
      console.log('Successfully connected to database');
      console.log('Users count:', usersResult.length);
    } catch (e) {
      console.log('Users table not ready yet or empty');
      usersResult = [];
    }
    
    // Проверяем карты
    try {
      const cardsResult = await db.select().from(schema.cards);
      console.log('Cards count:', cardsResult.length);
    } catch (e) {
      console.log('Cards table not ready yet or empty');
    }
    
    // Создаем базовые данные если база пуста
    if (usersResult && usersResult.length === 0) {
      console.log('Database is empty, creating initial data...');
      await createDefaultData();
    }
    
  } catch (error) {
    console.error('Error connecting to database:', error);
    throw error; // Propagate the error
  }
}

// Создание начальных данных для тестирования
async function createDefaultData() {
  try {
    // Создаем дефолтные курсы обмена
    await db.insert(schema.exchangeRates).values({
      usdToUah: "40.5",
      btcToUsd: "65000",
      ethToUsd: "3500"
    });
    console.log('Created default exchange rates');
    
    // В реальном коде здесь может быть создание тестовых пользователей
    // для примера, но мы оставим это для регистрации
    
  } catch (error) {
    console.error('Error creating default data:', error);
  }
}

// Export the initialization function
export async function initializeDatabase() {
  try {
    // Создаем таблицы
    await createTablesIfNotExist();
    
    // Проверяем содержимое базы
    await logDatabaseContent();

    console.log('Database initialization completed successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Функция для принудительного закрытия подключений
export async function closeConnectionsOnVercel() {
  // Neon serverless соединения управляются автоматически
  console.log('✅ Используем serverless - соединения закрываются автоматически');
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Closing database connection...');
  try {
    await closeConnectionsOnVercel();
  } catch (e) {
    console.error('Error closing database:', e);
  }
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Closing database connection...');
  try {
    await closeConnectionsOnVercel();
  } catch (e) {
    console.error('Error closing database:', e);
  }
});

// Initialize the database connection with simpler logic
async function initializeWithRetry() {
  try {
    console.log('Initializing database tables...');
    
    // Пробуем быстрое подключение с коротким таймаутом
    const quickTest = await withDatabaseTimeout(
      db.select().from(schema.users).limit(1),
      5000,
      'Quick database connection test'
    ).catch(error => {
      console.log('⚠️ Quick test failed, probably database is initializing...');
      return null;
    });
    
    if (quickTest !== null) {
      console.log('✅ Database already initialized and ready');
      return;
    }
    
    await initializeDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    // Не паникуем, продолжаем работу - таблицы могут уже существовать
  }
}

// Запускаем инициализацию без блокировки
initializeWithRetry();