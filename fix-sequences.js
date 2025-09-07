#!/usr/bin/env node

import { client } from './server/db.ts';

/**
 * Исправляет счетчики последовательности PostgreSQL после импорта данных с явными ID
 * Это решает проблему дублирования ключей при создании новых записей
 */

async function fixSequences() {
  try {
    console.log('🔧 Исправление счетчиков последовательности PostgreSQL...');

    // Исправляем последовательность для таблицы users
    const [maxUserId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM users`;
    const nextUserSeq = maxUserId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('users', 'id'), ${nextUserSeq}, false)`;
    console.log(`✅ Users sequence установлен на ${nextUserSeq}`);

    // Исправляем последовательность для таблицы cards
    const [maxCardId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM cards`;
    const nextCardSeq = maxCardId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('cards', 'id'), ${nextCardSeq}, false)`;
    console.log(`✅ Cards sequence установлен на ${nextCardSeq}`);

    // Исправляем последовательность для таблицы transactions
    const [maxTransactionId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM transactions`;
    const nextTransactionSeq = maxTransactionId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('transactions', 'id'), ${nextTransactionSeq}, false)`;
    console.log(`✅ Transactions sequence установлен на ${nextTransactionSeq}`);

    // Исправляем последовательность для таблицы exchange_rates
    const [maxRateId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM exchange_rates`;
    const nextRateSeq = maxRateId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('exchange_rates', 'id'), ${nextRateSeq}, false)`;
    console.log(`✅ Exchange rates sequence установлен на ${nextRateSeq}`);

    // Исправляем последовательность для таблицы nft_collections
    const [maxNftCollectionId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM nft_collections`;
    const nextNftCollectionSeq = maxNftCollectionId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('nft_collections', 'id'), ${nextNftCollectionSeq}, false)`;
    console.log(`✅ NFT Collections sequence установлен на ${nextNftCollectionSeq}`);

    // Исправляем последовательность для таблицы nfts
    const [maxNftId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM nfts`;
    const nextNftSeq = maxNftId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('nfts', 'id'), ${nextNftSeq}, false)`;
    console.log(`✅ NFTs sequence установлен на ${nextNftSeq}`);

    // Исправляем последовательность для таблицы nft_transfers
    const [maxNftTransferId] = await client`SELECT COALESCE(MAX(id), 0) as max_id FROM nft_transfers`;
    const nextNftTransferSeq = maxNftTransferId.max_id + 1;
    await client`SELECT setval(pg_get_serial_sequence('nft_transfers', 'id'), ${nextNftTransferSeq}, false)`;
    console.log(`✅ NFT Transfers sequence установлен на ${nextNftTransferSeq}`);

    console.log('');
    console.log('🎉 Все счетчики последовательности исправлены!');
    console.log('💡 Теперь приложение может создавать новые записи без ошибок дублирования ключей.');
    
  } catch (error) {
    console.error('❌ Ошибка при исправлении последовательностей:', error);
    process.exit(1);
  } finally {
    try {
      await client.end();
    } catch (err) {
      console.log('Подключение уже закрыто');
    }
  }
}

// Запускаем исправление
fixSequences();