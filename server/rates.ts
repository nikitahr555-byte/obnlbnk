import { storage } from "./storage.js";
import { WebSocket, WebSocketServer } from 'ws';
import { parse } from 'url';
import { IncomingMessage } from 'http';
import type { Server } from 'http';
import { withDatabaseRetry } from './db.js';

const COINGECKO_API_URL = "https://api.coingecko.com/api/v3";
const UPDATE_INTERVAL = 30000; // 30 секунд
const RETRY_DELAY = 60000; // 1 минута после ошибки
let wss: WebSocketServer;
let lastSuccessfulRates: { 
  usdToUah: string; 
  btcToUsd: string; 
  ethToUsd: string; 
  timestamp: number;
} | null = null;

// Функция для отправки обновлений курсов всем подключенным клиентам
function broadcastRates(rates: typeof lastSuccessfulRates) {
  if (!wss) return;

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(rates));
    }
  });
}

interface VerifyClientInfo {
  origin: string;
  secure: boolean;
  req: IncomingMessage;
}

export function startRateUpdates(server: Server, path: string = '/ws') {
  console.log("Запуск сервиса обновления курсов...");

  // Инициализация WebSocket сервера с проверкой пути
  wss = new WebSocketServer({ 
    server,
    verifyClient: (info: VerifyClientInfo) => {
      const { pathname } = parse(info.req.url || '');
      return pathname === path;
    }
  });

  wss.on('connection', (ws) => {
    console.log('Новое WebSocket подключение');

    // Отправляем текущие курсы при подключении
    if (lastSuccessfulRates) {
      ws.send(JSON.stringify(lastSuccessfulRates));
    }

    ws.on('error', (error) => {
      console.error('WebSocket ошибка:', error);
    });
  });

  // Начальное обновление
  fetchRates();

  // Настройка периодических обновлений
  setInterval(fetchRates, UPDATE_INTERVAL);
}

async function fetchRates() {
  try {
    // Проверяем кэш (5 минут)
    if (lastSuccessfulRates && Date.now() - lastSuccessfulRates.timestamp < 300000) {
      try {
        await withDatabaseRetry(
          () => storage.updateExchangeRates({
            usdToUah: parseFloat(lastSuccessfulRates!.usdToUah),
            btcToUsd: parseFloat(lastSuccessfulRates!.btcToUsd),
            ethToUsd: parseFloat(lastSuccessfulRates!.ethToUsd)
          }),
          3,
          'Update cached exchange rates'
        );
        broadcastRates(lastSuccessfulRates);
        return;
      } catch (dbError) {
        console.warn('⚠️ Ошибка обновления кэшированных курсов в БД:', dbError);
        // Продолжаем получать новые курсы
      }
    }

    console.log("Получаем курсы с альтернативного источника...");
    
    // Устанавливаем фиксированные значения курсов в случае недоступности API
    let btcToUsd = 83047;
    let ethToUsd = 1832.66;
    let usdToUah = 41.494461;
    
    try {
      // Пробуем получить данные от CoinGecko
      const cryptoResponse = await fetch(
        `${COINGECKO_API_URL}/simple/price?ids=bitcoin,ethereum&vs_currencies=usd`
      );

      if (cryptoResponse.ok) {
        const cryptoData = await cryptoResponse.json();
        if (cryptoData?.bitcoin?.usd && cryptoData?.ethereum?.usd) {
          btcToUsd = cryptoData.bitcoin.usd;
          ethToUsd = cryptoData.ethereum.usd;
        }
      }
    } catch (cryptoError) {
      console.warn("Не удалось получить курсы криптовалют:", cryptoError);
      // Продолжаем работу с фиксированными значениями
    }
    
    try {
      // Пробуем получить данные курса доллар/гривна
      const usdResponse = await fetch("https://open.er-api.com/v6/latest/USD");
      if (usdResponse.ok) {
        const usdData = await usdResponse.json();
        if (usdData?.rates?.UAH) {
          usdToUah = usdData.rates.UAH;
        }
      }
    } catch (usdError) {
      console.warn("Не удалось получить курс USD/UAH:", usdError);
      // Продолжаем работу с фиксированными значениями
    }

    const rates = {
      usdToUah: usdToUah.toString(),
      btcToUsd: btcToUsd.toString(),
      ethToUsd: ethToUsd.toString(),
      timestamp: Date.now()
    };

    // Сохраняем курсы в базу с retry логикой
    try {
      await withDatabaseRetry(
        () => storage.updateExchangeRates({
          usdToUah: parseFloat(rates.usdToUah),
          btcToUsd: parseFloat(rates.btcToUsd),
          ethToUsd: parseFloat(rates.ethToUsd)
        }),
        3,
        'Update exchange rates'
      );
      
      lastSuccessfulRates = rates;
      broadcastRates(rates);

      console.log("✅ Курсы валют успешно обновлены:", {
        usdToUah: usdToUah,
        btcToUsd: btcToUsd,
        ethToUsd: ethToUsd
      });
      
      console.log(`Текущие курсы для конвертации:
        1 USD = ${usdToUah} UAH
        1 BTC = ${btcToUsd} USD = ${btcToUsd * usdToUah} UAH
        1 ETH = ${ethToUsd} USD = ${ethToUsd * usdToUah} UAH`);
        
    } catch (dbError) {
      console.error("❌ Ошибка сохранения курсов в БД:", dbError);
      
      // Все равно кэшируем курсы и рассылаем клиентам
      lastSuccessfulRates = rates;
      broadcastRates(rates);
      
      console.log("⚠️ Курсы обновлены только в памяти (БД недоступна):", {
        usdToUah: usdToUah,
        btcToUsd: btcToUsd,
        ethToUsd: ethToUsd
      });
    }

  } catch (error) {
    console.error("❌ Ошибка получения курсов валют:", error);
    
    // Если у нас есть кэшированные курсы, используем их
    if (lastSuccessfulRates) {
      console.log("🔄 Используем последние успешные курсы");
      broadcastRates(lastSuccessfulRates);
      
      // Пытаемся обновить в БД кэшированные курсы
      try {
        await withDatabaseRetry(
          () => storage.updateExchangeRates({
            usdToUah: parseFloat(lastSuccessfulRates!.usdToUah),
            btcToUsd: parseFloat(lastSuccessfulRates!.btcToUsd),
            ethToUsd: parseFloat(lastSuccessfulRates!.ethToUsd)
          }),
          2,
          'Update cached rates fallback'
        );
      } catch (fallbackError) {
        console.warn("⚠️ Не удалось обновить кэшированные курсы в БД:", fallbackError);
      }
    }
    
    // Повторная попытка через минуту
    setTimeout(fetchRates, RETRY_DELAY);
  }
}