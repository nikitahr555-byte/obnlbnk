import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

// Кэшированное подключение к БД
let sql: any = null;

function initDatabase() {
  if (!sql && process.env.DATABASE_URL) {
    try {
      console.log('🔌 [VERCEL] Initializing database connection...');
      // Логируем только часть URL для безопасности
      const urlParts = process.env.DATABASE_URL.split('@');
      const dbHost = urlParts.length > 1 ? urlParts[1].split('/')[0] : 'unknown';
      console.log(`🔌 [VERCEL] Database host: ${dbHost}`);
      
      sql = neon(process.env.DATABASE_URL);
      console.log('✅ [VERCEL] Database connection initialized');
    } catch (error) {
      console.error('❌ [VERCEL] Database initialization failed:', error);
      return null;
    }
  }
  return sql;
}

// Проверка подключения к БД
async function testDatabaseConnection(db: any) {
  try {
    console.log('🔍 [VERCEL] Testing database connection...');
    await db`SELECT 1 as test`;
    console.log('✅ [VERCEL] Database connection test successful');
    return true;
  } catch (error) {
    console.error('❌ [VERCEL] Database connection test failed:', error);
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

    // Health check endpoint - не требует БД
    if (url.includes('/api/health')) {
      const hasDbUrl = !!process.env.DATABASE_URL;
      const dbUrlLength = process.env.DATABASE_URL ? process.env.DATABASE_URL.length : 0;
      
      return res.json({
        status: 'ok',
        database_url_present: hasDbUrl,
        database_url_length: dbUrlLength,
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

    // LOGIN - с упрощенной проверкой БД
    if (url.includes('/api/login') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        console.log(`🔐 [VERCEL] Login attempt for user: ${username}`);
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Ищем пользователя в БД БЕЗ предварительного тестирования подключения
        console.log('🔍 [VERCEL] Searching for user in database...');
        const users = await Promise.race([
          db`SELECT id, username, password, is_regulator FROM users WHERE username = ${username}`,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Database query timeout')), 15000))
        ]);
        
        console.log(`📊 [VERCEL] Found ${Array.isArray(users) ? users.length : 0} users`);
        
        if (!Array.isArray(users) || users.length === 0) {
          return res.status(401).json({ message: 'Неверные учетные данные' });
        }

        const user = users[0];
        console.log(`✅ [VERCEL] User found: ${user.username}`);
        
        // Проверяем пароль
        console.log('🔑 [VERCEL] Verifying password...');
        const isValidPassword = await bcrypt.compare(password, user.password);
        
        if (!isValidPassword) {
          console.log('❌ [VERCEL] Invalid password');
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
        
        // Если это ошибка 404 от Neon, значит проблема с DATABASE_URL
        if (error instanceof Error && error.message.includes('404')) {
          return res.status(500).json({ 
            message: 'База данных недоступна. Проверьте настройки подключения.',
            debug: 'Database not found (404) - check DATABASE_URL in Vercel environment variables'
          });
        }
        
        return res.status(500).json({ 
          message: 'Ошибка при входе в систему',
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
        const cookies = req.headers.cookie || '';
        const userDataMatch = cookies.match(/user_data=([^;]+)/);
        
        if (!userDataMatch) {
          console.log('❌ [VERCEL] No auth cookie found');
          return res.status(401).json({ message: 'Не авторизован' });
        }

        const userData = JSON.parse(Buffer.from(userDataMatch[1], 'base64').toString());
        console.log(`🔍 [VERCEL] Checking user: ${userData.username}`);
        
        // Проверяем срок действия токена (7 дней)
        if (Date.now() - userData.timestamp > 7 * 24 * 60 * 60 * 1000) {
          console.log('❌ [VERCEL] Token expired');
          return res.status(401).json({ message: 'Токен истек' });
        }

        // Проверяем пользователя в БД (с коротким timeout)
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

    // REGISTER - регистрация нового пользователя
    if (url.includes('/api/register') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        console.log(`📝 [VERCEL] Registration attempt for user: ${username}`);
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Проверяем существование пользователя
        const existingUsers = await db`SELECT id FROM users WHERE username = ${username}`;
        
        if (existingUsers.length > 0) {
          console.log('❌ [VERCEL] User already exists');
          return res.status(400).json({ message: 'Пользователь уже существует' });
        }

        // Хешируем пароль
        const hashedPassword = await bcrypt.hash(password, 12);

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