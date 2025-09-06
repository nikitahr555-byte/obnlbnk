/**
 * Специальный сервер для запуска в среде Replit
 * Отличается от основного сервера тем, что принудительно привязывается к порту 5000
 * и обеспечивает корректную интеграцию с NFT сервером
 */

import { createServer } from './server';

async function startServer() {
  console.log('🚀 Запуск сервера в режиме Replit...');
  
  // Привязка к порту 5000 обязательна для Replit
  const PORT = 5000;
  
  // Порт для NFT-сервера
  const NFT_SERVER_PORT = 8081;
  
  // Запускаем сервер с фиксированными настройками для Replit
  await createServer({
    port: PORT,
    host: '0.0.0.0',
    nftServerPort: NFT_SERVER_PORT,
    environment: 'development',
    logLevel: 'debug',
    forcePostgres: true
  });
  
  console.log(`✅ Сервер настроен для Replit и запущен на порту ${PORT}`);
}

// Запускаем сервер
startServer().catch(error => {
  console.error('❌ Ошибка при запуске сервера:', error);
  process.exit(1);
});