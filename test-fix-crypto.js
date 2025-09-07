#!/usr/bin/env node

// Скрипт для исправления криптоадресов в продакшен базе на Vercel
// Использование: node test-fix-crypto.js <ваш-домен-vercel>

import https from 'https';
import http from 'http';

const domain = process.argv[2];

if (!domain) {
  console.log('❌ Укажите домен Vercel!');
  console.log('📖 Использование: node test-fix-crypto.js your-app.vercel.app');
  process.exit(1);
}

const url = `https://${domain}/api/admin/fix-crypto-addresses`;

console.log(`🔧 Исправляем криптоадреса в продакшене...`);
console.log(`🌐 Адрес: ${url}`);

const postData = JSON.stringify({
  adminKey: 'fix_crypto_2024'
});

const options = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = https.request(url, options, (res) => {
  console.log(`📊 Статус ответа: ${res.statusCode}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    try {
      const result = JSON.parse(data);
      
      if (result.success) {
        console.log(`✅ УСПЕХ! ${result.message}`);
        console.log(`📈 Исправлено карт: ${result.fixed || 0}/${result.total || 0}`);
        
        if (result.results && result.results.length > 0) {
          console.log('\n📋 Детали исправленных карт:');
          result.results.forEach((card, index) => {
            if (card.status === 'fixed') {
              console.log(`  ${index + 1}. Карта ${card.cardId} (Пользователь ${card.userId})`);
              console.log(`     🪙 BTC: ${card.btcAddress}`);
              console.log(`     💎 ETH: ${card.ethAddress}`);
            } else if (card.status === 'error') {
              console.log(`  ${index + 1}. ❌ Карта ${card.cardId}: ${card.error}`);
            }
          });
        }
      } else {
        console.log(`❌ ОШИБКА: ${result.message}`);
      }
    } catch (e) {
      console.log('❌ Ошибка парсинга ответа:', e.message);
      console.log('📄 Сырой ответ:', data);
    }
  });
});

req.on('error', (e) => {
  console.log(`❌ Ошибка запроса: ${e.message}`);
  console.log('\n🔧 Возможные причины:');
  console.log('  1. Неверный домен Vercel');
  console.log('  2. Приложение не задеплоено');
  console.log('  3. Эндпоинт не работает');
  console.log('  4. Проблемы с сетью');
});

req.write(postData);
req.end();

console.log('\n⏳ Ожидание ответа от сервера...');