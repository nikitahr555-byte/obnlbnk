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

console.log('Connecting to PostgreSQL database...');

// Определяем, запущено ли приложение на Vercel
const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

// Создаем клиенты для разных окружений
let client: any;
let db: any;

if (IS_VERCEL) {
  // Используем Neon serverless клиент для Vercel - НЕТ ОГРАНИЧЕНИЙ СОЕДИНЕНИЙ!
  console.log('🚀 Используем Neon serverless клиент для Vercel');
  const sql = neon(databaseUrl);
  db = drizzleNeon(sql, { schema });
  client = sql; // Для совместимости
} else {
  // Используем обычный postgres клиент для Replit/локальной разработки
  console.log('🔧 Используем обычный postgres клиент для разработки');
  client = postgres(databaseUrl, { 
    ssl: { rejectUnauthorized: false },
    max: 3, // Больше соединений для разработки
    idle_timeout: 30,
    connect_timeout: 30,
    max_lifetime: 600,
    prepare: false,
    no_prepare: true,
    transform: {
      undefined: null
    },
    types: {
      date: {
        to: 1184,
        from: [1082, 1083, 1114, 1184],
        serialize: (date: Date) => date,
        parse: (date: string) => date
      }
    },
    onnotice: () => {},
    debug: false,
    connection: {
      application_name: 'replit-dev'
    }
  });
  db = drizzle(client, { schema });
}

// Экспортируем клиенты
export { client, db };

// Создаем таблицы в PostgreSQL базе данных
async function createTablesIfNotExist() {
  try {
    console.log('Checking and creating database tables if needed...');
    
    // Адаптируем запросы для разных клиентов
    const executeSQL = IS_VERCEL 
      ? (sql: string) => client(sql) // Neon serverless
      : (sql: string) => client([sql] as any); // postgres.js
    
    // Создаем таблицы с прямыми SQL запросами
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
    
    // Создаем таблицу для сессий если её нет
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS session (
        sid TEXT PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);

    // Создаем NFT таблицы
    await executeSQL(`
      CREATE TABLE IF NOT EXISTS nft_collections (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        name TEXT NOT NULL,
        description TEXT,
        cover_image TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await executeSQL(`
      CREATE TABLE IF NOT EXISTS nfts (
        id SERIAL PRIMARY KEY,
        collection_id INTEGER NOT NULL REFERENCES nft_collections(id),
        owner_id INTEGER NOT NULL REFERENCES users(id),
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

    await executeSQL(`
      CREATE TABLE IF NOT EXISTS nft_transfers (
        id SERIAL PRIMARY KEY,
        nft_id INTEGER NOT NULL REFERENCES nfts(id),
        from_user_id INTEGER NOT NULL REFERENCES users(id),
        to_user_id INTEGER NOT NULL REFERENCES users(id),
        transfer_type TEXT NOT NULL,
        price TEXT DEFAULT '0',
        transferred_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    
    console.log('Database tables created or verified successfully');
    return true;
  } catch (error) {
    console.error('Error creating tables:', error);
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
    
    // Добавляем новые колонки для KICHCOIN если их нет (для существующих таблиц)
    try {
      await executeSQL(`
        ALTER TABLE cards 
        ADD COLUMN IF NOT EXISTS kichcoin_balance TEXT NOT NULL DEFAULT '0'
      `);
      
      await executeSQL(`
        ALTER TABLE cards 
        ADD COLUMN IF NOT EXISTS ton_address TEXT
      `);
      
      console.log('✅ KICHCOIN колонки успешно добавлены в базу данных');
    } catch (error) {
      console.log('⚠️ Ошибка при добавлении KICHCOIN колонок:', error);
    }

console.log('Database initialization completed successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}

// Функция для принудительного закрытия подключений
export async function closeConnectionsOnVercel() {
  if (!IS_VERCEL && client && typeof client.end === 'function') {
    try {
      await client.end();
      console.log('✅ Database connections closed');
    } catch (e) {
      console.error('❌ Error closing database:', e);
    }
  }
  // На Vercel с Neon serverless соединения управляются автоматически
}

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM. Closing database connection...');
  try {
    await client.end();
  } catch (e) {
    console.error('Error closing database:', e);
  }
});

process.on('SIGINT', async () => {
  console.log('Received SIGINT. Closing database connection...');
  try {
    await client.end();
  } catch (e) {
    console.error('Error closing database:', e);
  }
});

// Initialize the database connection with simpler logic
async function initializeWithRetry() {
  try {
    console.log('Initializing database tables...');
    await initializeDatabase();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Database initialization failed:', error);
    // Не паникуем, продолжаем работу - таблицы могут уже существовать
  }
}

// Запускаем инициализацию без блокировки
initializeWithRetry();
