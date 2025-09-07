import type { VercelRequest, VercelResponse } from '@vercel/node';
import express from 'express';
import { registerRoutes } from '../server/routes.js';

let app: express.Application | null = null;

// Инициализируем основное приложение только один раз
async function getApp() {
  if (!app) {
    app = express();
    await registerRoutes(app);
  }
  return app;
}

// Основной обработчик для Vercel - используем реальный сервер
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    console.log(`🚀 [VERCEL] ${req.method} ${req.url}`);
    
    // CORS настройки
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Получаем инициализированное приложение
    const expressApp = await getApp();
    
    // Создаем совместимый с Express request/response
    const expressReq = req as any;
    const expressRes = res as any;
    
    // Добавляем необходимые методы для совместимости с Express
    expressReq.url = req.url;
    expressReq.method = req.method;
    expressReq.headers = req.headers;
    expressReq.body = req.body;
    
    // Обрабатываем через Express маршрутизатор
    expressApp(expressReq, expressRes);
    
  } catch (error) {
    console.error('❌ [VERCEL] Handler error:', error);
    return res.status(500).json({ 
      message: "Внутренняя ошибка сервера",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}