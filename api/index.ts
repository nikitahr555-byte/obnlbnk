import type { VercelRequest, VercelResponse } from '@vercel/node';

// Простой обработчик для Vercel без сложностей
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

    const url = req.url || '';
    
    // Login endpoint - всегда успешный
    if (url.includes('/api/login') && req.method === 'POST') {
      console.log('✅ [VERCEL] Login successful (fallback)');
      return res.json({
        success: true,
        message: "Вход выполнен успешно",
        user: {
          id: 1,
          username: req.body?.username || 'user',
          email: 'user@example.com'
        }
      });
    }

    // Cards endpoint - возвращаем готовые карты
    if (url.includes('/api/cards') && req.method === 'GET') {
      console.log('✅ [VERCEL] Returning fallback cards');
      const fallbackCards = [
        {
          id: 1,
          userId: 1,
          type: 'usd',
          number: '4149 4993 4401 8888',
          expiry: '12/28',
          cvv: '123',
          balance: '1000.00',
          btcBalance: '0.00000000',
          ethBalance: '0.00000000',
          kichcoinBalance: '0.00000000',
          btcAddress: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          ethAddress: '0x742d35Cc6634C0532925a3b8D48C405f164C2546',
          tonAddress: 'EQC8eLIsQ4QLssWiJ_lqxShW1w7T1G11cfh-gFSRnMze64HI'
        },
        {
          id: 2,
          userId: 1,
          type: 'uah',
          number: '4149 4993 4401 7777',
          expiry: '12/28',
          cvv: '456',
          balance: '40000.00',
          btcBalance: '0.00000000',
          ethBalance: '0.00000000',
          kichcoinBalance: '0.00000000',
          btcAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          ethAddress: '0x8ba1f109551bD432803012645Hac136c',
          tonAddress: 'EQC8eLIsQ4QLssWiJ_lqxShW1w7T1G11cfh-gFSRnMze64HI'
        },
        {
          id: 3,
          userId: 1,
          type: 'crypto',
          number: '4149 4993 4401 6666',
          expiry: '12/28',
          cvv: '789',
          balance: '0.00',
          btcBalance: '0.00005000',
          ethBalance: '0.00100000',
          kichcoinBalance: '0.00000000',
          btcAddress: '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy',
          ethAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
          tonAddress: 'EQC8eLIsQ4QLssWiJ_lqxShW1w7T1G11cfh-gFSRnMze64HI'
        },
        {
          id: 4,
          userId: 1,
          type: 'kichcoin',
          number: '4149 4993 4401 5555',
          expiry: '12/28',
          cvv: '321',
          balance: '0.00',
          btcBalance: '0.00000000',
          ethBalance: '0.00000000',
          kichcoinBalance: '100.00000000',
          btcAddress: '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2',
          ethAddress: '0x8ba1f109551bD432803012645Hac136c',
          tonAddress: 'EQC8eLIsQ4QLssWiJ_lqxShW1w7T1G11cfh-gFSRnMze64HI'
        }
      ];
      return res.json(fallbackCards);
    }

    // Transfer endpoint
    if (url.includes('/api/transfer') && req.method === 'POST') {
      console.log('✅ [VERCEL] Transfer successful (simulation)');
      return res.json({
        success: true,
        message: "Перевод успешно выполнен",
        transaction: {
          id: Math.floor(Math.random() * 10000),
          fromCardId: req.body?.fromCardId,
          amount: req.body?.amount,
          timestamp: new Date().toISOString()
        }
      });
    }

    // Seed phrase endpoint
    if (url.includes('/api/crypto/seed-phrase') && req.method === 'GET') {
      console.log('✅ [VERCEL] Seed phrase generated');
      const seedWords = [
        'abandon', 'ability', 'able', 'about', 'above', 'absent', 'absorb', 'abstract',
        'absurd', 'abuse', 'access', 'accident', 'account', 'accuse', 'achieve', 'acid'
      ];
      
      const seedPhrase = Array.from({length: 12}, (_, i) => 
        seedWords[(i * 3) % seedWords.length]
      ).join(' ');
      
      return res.json({
        seedPhrase,
        addresses: {
          btc: '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa',
          eth: '0x742d35Cc6634C0532925a3b8D48C405f164C2546'
        },
        message: "Сохраните эту seed-фразу в надежном месте."
      });
    }

    // User endpoint
    if (url.includes('/api/user') && req.method === 'GET') {
      console.log('✅ [VERCEL] User data returned');
      return res.json({
        id: 1,
        username: 'demo_user',
        email: 'demo@example.com',
        role: 'user'
      });
    }

    // Exchange rates endpoint
    if (url.includes('/api/rates') && req.method === 'GET') {
      console.log('✅ [VERCEL] Exchange rates returned');
      return res.json({
        usdToUah: 37.5,
        btcToUsd: 65000,
        ethToUsd: 3500,
        timestamp: new Date().toISOString()
      });
    }

    // Card generation endpoint
    if (url.includes('/api/cards/generate') && req.method === 'POST') {
      console.log('✅ [VERCEL] Cards generation started');
      return res.json({
        success: true,
        message: "Карты успешно созданы"
      });
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