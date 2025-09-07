import type { VercelRequest, VercelResponse } from '@vercel/node';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

// Кэшированное подключение к БД
let sql: any = null;

// Асинхронная версия scrypt для проверки старых паролей
const scryptAsync = promisify(scrypt);

// Проверка пароля с поддержкой разных форматов хеширования
async function verifyPassword(supplied: string, stored: string): Promise<boolean> {
  try {
    // Попробуем bcrypt (новый формат)
    if (stored.startsWith('$2')) {
      console.log('🔑 [VERCEL] Using bcrypt verification');
      return await bcrypt.compare(supplied, stored);
    }
    
    // Попробуем scrypt (старый формат с точкой)
    if (stored.includes('.')) {
      console.log('🔑 [VERCEL] Using scrypt verification');
      const [hashed, salt] = stored.split('.');
      const hashedBuf = Buffer.from(hashed, 'hex');
      const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
      return timingSafeEqual(hashedBuf, suppliedBuf);
    }
    
    // Простое сравнение (если пароль не хеширован)
    console.log('🔑 [VERCEL] Using plain text comparison');
    return supplied === stored;
    
  } catch (error) {
    console.error('❌ [VERCEL] Password verification error:', error);
    return false;
  }
}

// Извлечение пользователя из cookie
function extractUserFromCookie(req: VercelRequest): any {
  try {
    const cookies = req.headers.cookie || '';
    const userDataMatch = cookies.match(/user_data=([^;]+)/);
    
    if (!userDataMatch) {
      return null;
    }

    const userData = JSON.parse(Buffer.from(userDataMatch[1], 'base64').toString());
    
    // Проверяем срок действия токена (7 дней)
    if (Date.now() - userData.timestamp > 7 * 24 * 60 * 60 * 1000) {
      return null;
    }

    return userData;
  } catch (error) {
    console.error('❌ [VERCEL] Cookie extraction error:', error);
    return null;
  }
}

function initDatabase() {
  if (!sql && process.env.DATABASE_URL) {
    try {
      console.log('🔌 [VERCEL] Initializing database connection...');
      
      // Логируем детали подключения для диагностики
      const url = new URL(process.env.DATABASE_URL);
      console.log(`🔌 [VERCEL] Host: ${url.hostname}`);
      console.log(`🔌 [VERCEL] Database: ${url.pathname.substring(1)}`);
      console.log(`🔌 [VERCEL] Username: ${url.username}`);
      
      // Для Supabase используем обычный postgres клиент
      sql = postgres(process.env.DATABASE_URL, {
        ssl: 'require',
        max: 1,
        idle_timeout: 20,
        connect_timeout: 30,
        prepare: false,
        transform: {
          undefined: null
        },
        onnotice: () => {} // Отключаем уведомления
      });
      
      console.log('✅ [VERCEL] Database connection initialized');
    } catch (error) {
      console.error('❌ [VERCEL] Database initialization failed:', error);
      return null;
    }
  }
  return sql;
}

// Тест подключения с диагностикой
async function testDatabaseConnection(db: any) {
  try {
    console.log('🔍 [VERCEL] Testing database connection and checking tables...');
    
    // Проверяем подключение
    await db`SELECT 1 as test`;
    console.log('✅ [VERCEL] Basic connection successful');
    
    // Проверяем существование таблицы users
    const tableExists = await db`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'users'
      );
    `;
    console.log(`🔍 [VERCEL] Users table exists: ${tableExists[0]?.exists || false}`);
    
    if (tableExists[0]?.exists) {
      // Считаем количество пользователей
      const userCount = await db`SELECT COUNT(*) as count FROM users`;
      console.log(`👥 [VERCEL] Total users in database: ${userCount[0]?.count || 0}`);
      
      // Показываем несколько пользователей для диагностики
      const sampleUsers = await db`SELECT username, LENGTH(password) as pass_len FROM users LIMIT 5`;
      console.log(`📝 [VERCEL] Sample users:`, sampleUsers.map(u => `${u.username} (pass_len: ${u.pass_len})`));
    }
    
    return true;
  } catch (error) {
    console.error('❌ [VERCEL] Database test failed:', error);
    return false;
  }
}

// Основной обработчик для Vercel
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log(`🚀 [VERCEL] ${req.method} ${req.url}`);
    
    // CORS настройки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    const url = req.url || '';

    // Health check endpoint
    if (url.includes('/api/health')) {
      const hasDbUrl = !!process.env.DATABASE_URL;
      const db = initDatabase();
      let dbStatus = 'not_initialized';
      
      if (db) {
        try {
          const isConnected = await testDatabaseConnection(db);
          dbStatus = isConnected ? 'connected' : 'connection_failed';
        } catch (error) {
          dbStatus = 'test_failed';
        }
      }
      
      return res.json({
        status: 'ok',
        database_url_present: hasDbUrl,
        database_status: dbStatus,
        timestamp: new Date().toISOString(),
        environment: 'vercel'
      });
    }
    
    // Проверяем наличие DATABASE_URL
    if (!process.env.DATABASE_URL) {
      console.error('❌ [VERCEL] DATABASE_URL not found in environment variables');
      return res.status(500).json({ 
        message: 'База данных не настроена. Обратитесь к администратору.',
        debug: 'DATABASE_URL missing from environment'
      });
    }

    const db = initDatabase();
    if (!db) {
      return res.status(500).json({ 
        message: 'Не удалось подключиться к базе данных',
        debug: 'Database initialization failed'
      });
    }

    // LOGIN - с улучшенной проверкой паролей
    if (url.includes('/api/login') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        console.log(`🔐 [VERCEL] Login attempt for user: ${username}`);
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Сначала проверим подключение и таблицы для диагностики
        console.log('🔍 [VERCEL] Checking database connection and tables...');
        await testDatabaseConnection(db);

        // Ищем пользователя в БД
        console.log('🔍 [VERCEL] Searching for user in database...');
        const users = await Promise.race([
          db`SELECT id, username, password, is_regulator FROM users WHERE username = ${username}`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 15000))
        ]);
        
        console.log(`📊 [VERCEL] Found ${Array.isArray(users) ? users.length : 0} users`);
        
        if (!Array.isArray(users) || users.length === 0) {
          // Дополнительная диагностика - проверяем все usernames в БД
          try {
            const allUsers = await db`SELECT username FROM users LIMIT 10`;
            console.log(`🔍 [VERCEL] Available usernames:`, allUsers.map(u => u.username));
          } catch (e) {
            console.log(`❌ [VERCEL] Could not fetch usernames for debugging:`, e);
          }
          
          return res.status(401).json({ message: 'Неверные учетные данные' });
        }

        const user = users[0];
        console.log(`✅ [VERCEL] User found: ${user.username}`);
        console.log(`🔍 [VERCEL] Password format: ${user.password.startsWith('$2') ? 'bcrypt' : user.password.includes('.') ? 'scrypt' : 'plain'}`);
        
        // Проверяем пароль с поддержкой разных форматов
        console.log('🔑 [VERCEL] Verifying password...');
        const isValidPassword = await verifyPassword(password, user.password);
        
        if (!isValidPassword) {
          console.log('❌ [VERCEL] Invalid password');
          console.log(`🔍 [VERCEL] Password hash preview: ${user.password.substring(0, 20)}...`);
          return res.status(401).json({ message: 'Неверные учетные данные' });
        }

        console.log('✅ [VERCEL] Password verified successfully');

        // Устанавливаем cookie с данными пользователя
        const userData = { id: user.id, username: user.username, timestamp: Date.now() };
        const token = Buffer.from(JSON.stringify(userData)).toString('base64');
        
        res.setHeader('Set-Cookie', `user_data=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
        
        console.log(`✅ [VERCEL] Login successful for user: ${user.username}`);
        return res.json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator || false
        });
        
      } catch (error) {
        console.error('❌ [VERCEL] Login error:', error);
        return res.status(500).json({ 
          message: 'Ошибка при входе в систему',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // REGISTER - создаем пользователя с bcrypt хешированием
    if (url.includes('/api/register') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        console.log(`📝 [VERCEL] Registration attempt for user: ${username}`);
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Диагностика БД перед регистрацией
        await testDatabaseConnection(db);

        // Проверяем существование пользователя
        const existingUsers = await db`SELECT id FROM users WHERE username = ${username}`;
        
        if (existingUsers.length > 0) {
          console.log('❌ [VERCEL] User already exists');
          return res.status(400).json({ message: 'Пользователь уже существует' });
        }

        // Хешируем пароль используя bcrypt
        console.log('🔑 [VERCEL] Hashing password with bcrypt...');
        const hashedPassword = await bcrypt.hash(password, 12);
        console.log(`🔍 [VERCEL] Generated password hash: ${hashedPassword.substring(0, 20)}...`);

        // Создаем пользователя
        const newUser = await db`
          INSERT INTO users (username, password, is_regulator, regulator_balance, nft_generation_count)
          VALUES (${username}, ${hashedPassword}, false, '0', 0)
          RETURNING id, username, is_regulator
        `;

        const user = newUser[0];
        console.log(`✅ [VERCEL] User created: ${user.username}`);

        // Устанавливаем cookie
        const userData = { id: user.id, username: user.username, timestamp: Date.now() };
        const token = Buffer.from(JSON.stringify(userData)).toString('base64');
        
        res.setHeader('Set-Cookie', `user_data=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
        
        return res.status(201).json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator || false
        });
        
      } catch (error) {
        console.error('❌ [VERCEL] Register error:', error);
        return res.status(500).json({ 
          message: 'Ошибка при регистрации',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // LOGOUT - очистка cookie
    if (url.includes('/api/logout') && req.method === 'POST') {
      console.log('🚪 [VERCEL] Logout request');
      res.setHeader('Set-Cookie', 'user_data=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
      return res.status(200).end();
    }

    // USER - проверка текущего пользователя через cookie
    if (url.includes('/api/user') && req.method === 'GET') {
      try {
        console.log('👤 [VERCEL] User check request');
        const userData = extractUserFromCookie(req);
        
        if (!userData) {
          console.log('❌ [VERCEL] No auth cookie found');
          return res.status(401).json({ message: 'Не авторизован' });
        }

        console.log(`🔍 [VERCEL] Checking user: ${userData.username}`);

        // Проверяем пользователя в БД
        const users = await Promise.race([
          db`SELECT id, username, is_regulator FROM users WHERE id = ${userData.id} AND username = ${userData.username}`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('User check timeout')), 8000))
        ]);
        
        if (!Array.isArray(users) || users.length === 0) {
          console.log('❌ [VERCEL] User not found in database');
          return res.status(401).json({ message: 'Пользователь не найден' });
        }

        const user = users[0];
        console.log(`✅ [VERCEL] User verified: ${user.username}`);
        return res.json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator || false
        });
        
      } catch (error) {
        console.error('❌ [VERCEL] User check error:', error);
        return res.status(401).json({ 
          message: 'Ошибка авторизации',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // CARDS - получение карт пользователя
    if (url.includes('/api/cards') && req.method === 'GET') {
      try {
        console.log('💳 [VERCEL] Cards request');
        const userData = extractUserFromCookie(req);
        
        if (!userData) {
          console.log('❌ [VERCEL] No auth cookie for cards request');
          return res.status(401).json({ message: 'Необходима авторизация' });
        }

        console.log(`🔍 [VERCEL] Getting cards for user: ${userData.username}`);

        // Получаем карты пользователя
        const cards = await Promise.race([
          db`SELECT * FROM cards WHERE user_id = ${userData.id} ORDER BY id DESC`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Cards query timeout')), 8000))
        ]);
        
        console.log(`📊 [VERCEL] Found ${Array.isArray(cards) ? cards.length : 0} cards for user`);
        return res.json(cards || []);
        
      } catch (error) {
        console.error('❌ [VERCEL] Cards error:', error);
        return res.status(500).json({ 
          message: 'Ошибка при получении карт',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // TRANSACTIONS - получение транзакций пользователя
    if (url.includes('/api/transactions') && req.method === 'GET') {
      try {
        console.log('📊 [VERCEL] Transactions request');
        const userData = extractUserFromCookie(req);
        
        if (!userData) {
          return res.status(401).json({ message: 'Необходима авторизация' });
        }

        console.log(`🔍 [VERCEL] Getting transactions for user: ${userData.username}`);

        // Получаем транзакции пользователя
        const transactions = await Promise.race([
          db`SELECT DISTINCT t.* FROM transactions t 
             LEFT JOIN cards c1 ON t.from_card_id = c1.id 
             LEFT JOIN cards c2 ON t.to_card_id = c2.id 
             WHERE c1.user_id = ${userData.id} OR c2.user_id = ${userData.id} 
             ORDER BY t.created_at DESC LIMIT 50`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Transactions query timeout')), 8000))
        ]);
        
        console.log(`📊 [VERCEL] Found ${Array.isArray(transactions) ? transactions.length : 0} transactions for user`);
        return res.json(transactions || []);
        
      } catch (error) {
        console.error('❌ [VERCEL] Transactions error:', error);
        return res.status(500).json({ 
          message: 'Ошибка при получении транзакций',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // NFT Collections - получение NFT коллекций
    if (url.includes('/api/nft/collections') && req.method === 'GET') {
      try {
        console.log('🎨 [VERCEL] NFT Collections request');
        
        // Возвращаем базовые коллекции
        const collections = [
          {
            id: 1,
            name: 'Bored Ape Yacht Club',
            slug: 'bored_ape_yacht_club',
            description: 'Коллекция уникальных цифровых обезьян',
            floor_price: '10.5',
            total_items: 10000,
            image_url: '/api/nft/image/bored_ape_yacht_club/1'
          },
          {
            id: 2,
            name: 'Mutant Ape Yacht Club',
            slug: 'mutant_ape_yacht_club',
            description: 'Мутантские обезьяны из BAYC',
            floor_price: '5.2',
            total_items: 20000,
            image_url: '/api/nft/image/mutant_ape_yacht_club/1'
          }
        ];
        
        return res.json(collections);
        
      } catch (error) {
        console.error('❌ [VERCEL] NFT Collections error:', error);
        return res.status(500).json({ 
          message: 'Ошибка при получении NFT коллекций',
          debug: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    // Exchange Rates - курсы валют
    if (url.includes('/api/rates') && req.method === 'GET') {
      console.log('💱 [VERCEL] Exchange rates request');
      return res.json({
        usdToUah: 41.0,
        btcToUsd: 100000,
        ethToUsd: 4000,
        timestamp: new Date().toISOString()
      });
    }

    // WebSocket endpoint (не поддерживается в Vercel)
    if (url.includes('/ws')) {
      console.log('🔌 [VERCEL] WebSocket request (not supported)');
      return res.status(404).json({ message: 'WebSocket не поддерживается в Vercel' });
    }

    // Для остальных API путей - требуем авторизации
    if (url.startsWith('/api/')) {
      return res.status(401).json({ message: 'Необходима авторизация' });
    }

    // Default fallback
    console.log(`❓ [VERCEL] Unhandled route: ${req.method} ${url}`);
    return res.status(404).json({ 
      message: "Эндпоинт не найден",
      url: url,
      method: req.method
    });

  } catch (error) {
    console.error('❌ [VERCEL] Handler error:', error);
    return res.status(500).json({ 
      message: "Внутренняя ошибка сервера",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}