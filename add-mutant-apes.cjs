/**
 * Скрипт для добавления коллекции Mutant Ape Yacht Club (10,000 NFT)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Получаем строку подключения из переменной окружения
const DATABASE_URL = process.env.DATABASE_URL;

// Настраиваем пул подключений
const pool = new Pool({
  connectionString: DATABASE_URL,
});

/**
 * Сканирует директорию с изображениями обезьян
 * @param {string} directory Путь к директории для сканирования
 * @param {string} prefix Префикс для формирования пути к изображению
 * @returns {Array<{path: string, fullPath: string}>} Массив объектов с путями к изображениям
 */
function scanApeDirectory(directory, prefix) {
  const baseDir = '/home/runner/workspace';
  const dirPath = path.join(baseDir, directory);
  
  try {
    if (!fs.existsSync(dirPath)) {
      console.log(`Директория ${dirPath} не существует`);
      return [];
    }
    
    const files = fs.readdirSync(dirPath);
    const imagePaths = [];
    
    for (const file of files) {
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.avif')) {
        const relativePath = path.join(prefix, file);
        const fullPath = path.join(dirPath, file);
        
        imagePaths.push({
          path: relativePath,
          fullPath: fullPath
        });
      }
    }
    
    return imagePaths;
  } catch (err) {
    console.error(`Ошибка при сканировании директории ${dirPath}:`, err);
    return [];
  }
}

/**
 * Определяет редкость NFT на основе его ID
 * @param {number} tokenId ID токена
 * @returns {string} Редкость NFT
 */
function determineRarity(tokenId) {
  // Используем модульное распределение для определения редкости
  const remainder = tokenId % 100;
  
  if (remainder < 60) {
    return 'common';
  } else if (remainder < 85) {
    return 'uncommon';
  } else if (remainder < 95) {
    return 'rare';
  } else if (remainder < 99) {
    return 'epic';
  } else {
    return 'legendary';
  }
}

/**
 * Генерирует цену для NFT на основе редкости
 * @param {string} rarity Редкость NFT
 * @returns {string} Цена NFT
 */
function generatePrice(rarity) {
  // Мутанты дороже на 50%
  const mutantMultiplier = 1.5;
  
  switch (rarity) {
    case 'common':
      return (30 * mutantMultiplier + Math.random() * 20).toFixed(2);
    case 'uncommon':
      return (500 * mutantMultiplier + Math.random() * 500).toFixed(2);
    case 'rare':
      return (2000 * mutantMultiplier + Math.random() * 1000).toFixed(2);
    case 'epic':
      return (5000 * mutantMultiplier + Math.random() * 3000).toFixed(2);
    case 'legendary':
      return (12000 * mutantMultiplier + Math.random() * 7000).toFixed(2);
    default:
      return (50 * mutantMultiplier).toFixed(2);
  }
}

/**
 * Генерирует атрибуты для NFT
 * @param {number} tokenId ID токена
 * @param {string} rarity Редкость NFT
 * @returns {Object} Объект с атрибутами
 */
function generateAttributes(tokenId, rarity) {
  // Используем tokenId как seed для псевдослучайных значений
  const seed = tokenId;
  
  let baseValue = 0;
  
  switch (rarity) {
    case 'common':
      baseValue = 40 + (seed % 11);
      break;
    case 'uncommon':
      baseValue = 55 + (seed % 11);
      break;
    case 'rare':
      baseValue = 65 + (seed % 11);
      break;
    case 'epic':
      baseValue = 75 + (seed % 11);
      break;
    case 'legendary':
      baseValue = 85 + (seed % 11);
      break;
    default:
      baseValue = 50 + (seed % 11);
  }
  
  // Мутанты имеют бонусы к силе и ловкости, но штраф к мудрости
  const powerBonus = 15;
  const agilityBonus = 5;
  const wisdomPenalty = -5;
  const luckBonus = 10;
  
  // Генерация случайных вариаций для избежания одинаковых атрибутов
  function randomVariation(seed, base) {
    const hash = crypto.createHash('md5').update(seed.toString()).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);
    return Math.abs(hashValue % 11) - 5; // От -5 до 5
  }
  
  const power = Math.min(100, Math.max(1, baseValue + powerBonus + randomVariation(seed + 1, baseValue)));
  const agility = Math.min(100, Math.max(1, baseValue + agilityBonus + randomVariation(seed + 2, baseValue)));
  const wisdom = Math.min(100, Math.max(1, baseValue + wisdomPenalty + randomVariation(seed + 3, baseValue)));
  const luck = Math.min(100, Math.max(1, baseValue + luckBonus + randomVariation(seed + 4, baseValue)));
  
  return {
    power,
    agility,
    wisdom,
    luck
  };
}

/**
 * Добавление коллекции Mutant Ape Yacht Club (10,000 NFT)
 */
async function addMutantApes() {
  console.log('Запуск добавления коллекции Mutant Ape Yacht Club...');
  
  try {
    // Шаг 1: Сканируем директории с изображениями обезьян
    console.log('Шаг 1: Сканирование директорий с изображениями мутантов...');
    
    // Сканируем Mutant Ape NFT
    const mutantApeImages = scanApeDirectory('/mutant_ape_nft', '/mutant_ape_nft');
    console.log(`Найдено ${mutantApeImages.length} изображений Mutant Ape`);
    
    // Если мутантов мало, используем изображения Bored Ape
    let fallbackImages = [];
    if (mutantApeImages.length < 100) {
      console.log('Недостаточно изображений Mutant Ape, загружаем Bored Ape в качестве запасного варианта...');
      fallbackImages = scanApeDirectory('/bored_ape_nft', '/bored_ape_nft');
      console.log(`Загружено ${fallbackImages.length} запасных изображений Bored Ape`);
    }
    
    // Финальный массив изображений
    const imageArray = mutantApeImages.length >= 100 ? mutantApeImages : (mutantApeImages.concat(fallbackImages));
    console.log(`Всего доступно ${imageArray.length} изображений для Mutant Ape NFT`);
    
    // Шаг 2: Удаляем существующие NFT в коллекции Mutant Ape
    console.log('Шаг 2: Удаление существующих NFT в коллекции Mutant Ape...');
    await pool.query('DELETE FROM nfts WHERE collection_id = 2');
    
    // Шаг 3: Добавляем 10,000 NFT в коллекцию Mutant Ape
    console.log('Шаг 3: Добавление 10,000 NFT в коллекцию Mutant Ape...');
    
    // Используем батчи по 100 NFT для INSERT
    const batchSize = 100;
    const ownerId = 1; // ID администратора/владельца
    const collectionId = 2; // ID коллекции Mutant Ape
    
    for (let batchStart = 1; batchStart <= 10000; batchStart += batchSize) {
      const batchEnd = Math.min(batchStart + batchSize - 1, 10000);
      console.log(`Обработка NFT ${batchStart} - ${batchEnd}...`);
      
      let insertQuery = 'INSERT INTO nfts (token_id, name, description, image_path, price, for_sale, owner_id, collection_id, rarity, attributes, minted_at, sort_order) VALUES ';
      const values = [];
      let valueIndex = 1;
      
      for (let i = batchStart; i <= batchEnd; i++) {
        // Выбираем случайное изображение из доступных
        const randomIndex = Math.floor(Math.random() * imageArray.length);
        const img = imageArray[randomIndex];
        
        const tokenId = i + 10000; // ID от 10001 до 20000
        const name = `Mutant Ape #${i}`; // ID мутантов начинаются с 1, но token_id с 10001
        const rarity = determineRarity(tokenId);
        const price = generatePrice(rarity);
        const attributes = JSON.stringify(generateAttributes(tokenId, rarity));
        const sortOrder = Math.floor(Math.random() * 20000); // Случайный порядок сортировки
        const description = `Mutant Ape Yacht Club NFT #${i}. Редкость: ${rarity}. Уникальный цифровой актив на блокчейне.`;
        
        if (i > batchStart) {
          insertQuery += ', ';
        }
        
        insertQuery += `($${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++}, $${valueIndex++})`;
        
        values.push(
          tokenId.toString(),
          name,
          description,
          img.path,
          price,
          true,
          ownerId,
          collectionId,
          rarity,
          attributes,
          new Date(),
          sortOrder
        );
      }
      
      try {
        await pool.query(insertQuery, values);
      } catch (err) {
        console.error(`Ошибка при добавлении NFT ${batchStart}-${batchEnd}:`, err);
      }
    }
    
    // Шаг 4: Проверка результатов
    const countQuery = 'SELECT COUNT(*) FROM nfts WHERE collection_id = 2';
    const countResult = await pool.query(countQuery);
    const totalNFTs = parseInt(countResult.rows[0].count);
    
    console.log(`\nИтоговое количество Mutant Ape NFT в базе данных: ${totalNFTs}`);
    
    // Статистика по редкости
    const rarityStatsQuery = 'SELECT rarity, COUNT(*) FROM nfts WHERE collection_id = 2 GROUP BY rarity ORDER BY COUNT(*) DESC';
    const rarityStatsResult = await pool.query(rarityStatsQuery);
    
    console.log('\nСтатистика по редкости Mutant Ape:');
    rarityStatsResult.rows.forEach(row => {
      console.log(`${row.rarity}: ${row.count} NFT`);
    });
    
    // Общая статистика
    const totalCountQuery = 'SELECT COUNT(*) FROM nfts';
    const totalCountResult = await pool.query(totalCountQuery);
    const grandTotal = parseInt(totalCountResult.rows[0].count);
    
    console.log(`\nОбщее количество NFT в базе данных: ${grandTotal}`);
    
    return {
      success: true,
      totalMutantApes: totalNFTs,
      grandTotal: grandTotal,
      byRarity: rarityStatsResult.rows
    };
    
  } catch (err) {
    console.error('Критическая ошибка при добавлении коллекции Mutant Ape:', err);
    return {
      success: false,
      error: err.message
    };
  } finally {
    console.log('Завершение работы скрипта');
    await pool.end();
  }
}

// Запуск скрипта
addMutantApes()
  .then(result => {
    console.log('\nРезультаты добавления коллекции Mutant Ape:');
    console.log(JSON.stringify(result, null, 2));
    console.log('\n===============================');
    console.log('✅ Добавление 10,000 Mutant Ape NFT успешно завершено!');
    console.log('===============================\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('\n❌ Критическая ошибка:', err);
    process.exit(1);
  });