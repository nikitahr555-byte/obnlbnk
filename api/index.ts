import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import bcrypt from 'bcryptjs';

// Простая инициализация БД для Vercel
let sql: any = null;

function initDatabase() {
  if (!sql && process.env.DATABASE_URL) {
    sql = neon(process.env.DATABASE_URL);
  }
  return sql;
}

// Основной обработчик для Vercel - минимальная реализация без демо-режима
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
    const db = initDatabase();
    
    if (!db) {
      return res.status(500).json({ message: 'База данных недоступна' });
    }

    // LOGIN - реальная проверка через БД
    if (url.includes('/api/login') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Ищем пользователя в БД
        const users = await db`SELECT * FROM users WHERE username = ${username}`;
        
        if (users.length === 0) {
          return res.status(401).json({ message: 'Неверные учетные данные' });
        }

        const user = users[0];
        
        // Проверяем пароль
        const isValidPassword = await bcrypt.compare(password, user.password);
        
        if (!isValidPassword) {
          return res.status(401).json({ message: 'Неверные учетные данные' });
        }

        // Устанавливаем cookie с данными пользователя
        const userData = { id: user.id, username: user.username, timestamp: Date.now() };
        const token = Buffer.from(JSON.stringify(userData)).toString('base64');
        
        res.setHeader('Set-Cookie', `user_data=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
        
        return res.json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator
        });
        
      } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ message: 'Ошибка при входе в систему' });
      }
    }

    // LOGOUT - очистка cookie
    if (url.includes('/api/logout') && req.method === 'POST') {
      res.setHeader('Set-Cookie', 'user_data=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/');
      return res.status(200).end();
    }

    // USER - проверка текущего пользователя через cookie
    if (url.includes('/api/user') && req.method === 'GET') {
      try {
        const cookies = req.headers.cookie || '';
        const userDataMatch = cookies.match(/user_data=([^;]+)/);
        
        if (!userDataMatch) {
          return res.status(401).json({ message: 'Не авторизован' });
        }

        const userData = JSON.parse(Buffer.from(userDataMatch[1], 'base64').toString());
        
        // Проверяем срок действия токена (7 дней)
        if (Date.now() - userData.timestamp > 7 * 24 * 60 * 60 * 1000) {
          return res.status(401).json({ message: 'Токен истек' });
        }

        // Проверяем пользователя в БД
        const users = await db`SELECT * FROM users WHERE id = ${userData.id} AND username = ${userData.username}`;
        
        if (users.length === 0) {
          return res.status(401).json({ message: 'Пользователь не найден' });
        }

        const user = users[0];
        return res.json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator
        });
        
      } catch (error) {
        console.error('User check error:', error);
        return res.status(401).json({ message: 'Ошибка авторизации' });
      }
    }

    // REGISTER - регистрация нового пользователя
    if (url.includes('/api/register') && req.method === 'POST') {
      try {
        const { username, password } = req.body;
        
        if (!username || !password) {
          return res.status(400).json({ message: 'Требуется имя пользователя и пароль' });
        }

        // Проверяем существование пользователя
        const existingUsers = await db`SELECT id FROM users WHERE username = ${username}`;
        
        if (existingUsers.length > 0) {
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

        // Устанавливаем cookie
        const userData = { id: user.id, username: user.username, timestamp: Date.now() };
        const token = Buffer.from(JSON.stringify(userData)).toString('base64');
        
        res.setHeader('Set-Cookie', `user_data=${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=604800; Path=/`);
        
        return res.status(201).json({
          id: user.id,
          username: user.username,
          is_regulator: user.is_regulator
        });
        
      } catch (error) {
        console.error('Register error:', error);
        return res.status(500).json({ message: 'Ошибка при регистрации' });
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