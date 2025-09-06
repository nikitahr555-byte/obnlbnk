import type { Express } from "express";
import { createServer, type Server } from "http";
import fs from 'fs';
import path from 'path';
import { storage } from "./storage.js";
import { exportDatabase, importDatabase } from './database/backup.js';
import { setupAuth } from './auth.js';
import { startRateUpdates } from './rates.js';
import express from 'express';
import fetch from 'node-fetch';

// Расширяем типы сессии
declare global {
  namespace Express {
    interface Session {
      user?: string;
    }
  }
}

import { getExchangeRate, createExchangeTransaction, getTransactionStatus } from './exchange-service.js';
import { getNews } from './news-service.js';
import { seaTableManager } from './utils/seatable.js';
import { generateValidAddress, validateCryptoAddress, getSeedPhraseForUser } from './utils/crypto.js';
import { hasBlockchainApiKeys } from './utils/blockchain.js';
import { generateAddressesForUser, isValidMnemonic, getAddressesFromMnemonic } from './utils/seed-phrase.js';
// import { generateNFTImage } from './utils/nft-generator.js'; // Исключено для Vercel
import { db } from './db.js';
import { eq } from 'drizzle-orm';
import { nfts, nftCollections } from '../shared/schema.js';
import nftRoutes from './controllers/nft-controller.js';
import nftImportRoutes from './controllers/nft-import-controller.js';
import nftMarketplaceRoutes from './controllers/nft-marketplace-controller.js';
// import nftServerController from './controllers/nft-server-controller.js'; // Исключено для Vercel
import { staticAssetsRouter } from './routes/static-assets.js';
import { serveStatic } from './vite-vercel.js';
import { setupDebugRoutes } from "./debug.js";

// Auth middleware с улучшенной обработкой для Vercel
function ensureAuthenticated(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    console.log('🔐 [VERCEL] Auth check - Session ID:', req.sessionID);
    console.log('🔐 [VERCEL] isAuthenticated:', req.isAuthenticated());
    console.log('🔐 [VERCEL] User:', req.user ? `${req.user.username} (ID: ${req.user.id})` : 'none');
    
    // Основная проверка аутентификации
    if (req.isAuthenticated() && req.user) {
      console.log('✅ [VERCEL] Authentication successful for user:', req.user.username);
      return next();
    }
    
    // Fallback проверка через cookie для Vercel serverless
    const authCookie = req.cookies['vercel_auth_user'];
    if (authCookie) {
      try {
        const userData = JSON.parse(authCookie);
        if (userData && userData.username) {
          console.log('✅ [VERCEL] Cookie authentication successful for user:', userData.username);
          // Добавляем пользователя в req для совместимости
          (req as any).user = userData;
          return next();
        }
      } catch (cookieError) {
        console.log('❌ [VERCEL] Cookie auth parse error:', cookieError);
      }
    }
    
    console.log('❌ [VERCEL] Authentication failed - isAuthenticated:', req.isAuthenticated(), 'user:', !!req.user);
    res.status(401).json({ message: "Необходима авторизация" });
  } catch (error) {
    console.error('❌ [VERCEL] Authentication middleware error:', error);
    res.status(500).json({ message: "Ошибка авторизации" });
  }
}

// Vercel-совместимая версия registerRoutes
export async function registerRoutes(app: Express): Promise<Server> {
  console.log('🔧 Регистрация маршрутов для Vercel...');

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  setupAuth(app);

  // Статические ресурсы
  app.use('/bored_ape_nft', express.static(path.join(process.cwd(), 'bored_ape_nft')));
  app.use('/public/assets/nft', express.static(path.join(process.cwd(), 'client/public/assets/nft')));
  app.use('/bayc_official', express.static(path.join(process.cwd(), 'client/public/bayc_official')));
  app.use(staticAssetsRouter);

  // API маршруты
  app.use('/api/nft', nftRoutes);
  app.use('/api/nft/marketplace', nftMarketplaceRoutes);
  app.use('/api/nft-import', nftImportRoutes);

  setupDebugRoutes(app);

  // Основные API endpoints
  app.get("/api/rates", async (req, res) => {
    try {
      // Добавляем HTTP кэширование для уменьшения нагрузки
      res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300'); // 5 минут кэш
      res.setHeader('ETag', `"rates-${Math.floor(Date.now() / 300000)}"`); // ETag основан на 5-минутных интервалах
      
      // Добавляем таймаут для Vercel
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('API timeout')), 15000); // 15 сек для Vercel
      });
      
      const ratesPromise = storage.getLatestExchangeRates();
      const rates = await Promise.race([ratesPromise, timeoutPromise]);
      
      if (!rates) {
        // Возвращаем дефолтные курсы если база недоступна
        return res.json({
          usdToUah: "40.5",
          btcToUsd: "65000", 
          ethToUsd: "3500",
          updatedAt: new Date().toISOString()
        });
      }
      
      res.json(rates);
    } catch (error) {
      console.error("Ошибка получения курсов:", error);
      // Возвращаем дефолтные курсы при ошибке
      res.json({
        usdToUah: "40.5",
        btcToUsd: "65000",
        ethToUsd: "3500",
        updatedAt: new Date().toISOString()
      });
    }
  });

  app.get("/api/cards", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user || !req.user.id) return res.status(401).json({ message: "Пользователь не авторизован" });

      // Добавляем таймаут и кэширование для карт
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Cards API timeout')), 15000);
      });
      
      const cardsPromise = storage.getCardsByUserId(req.user.id);
      const cards = await Promise.race([cardsPromise, timeoutPromise]);
      
      // Кэширование HTTP response
      res.setHeader('Cache-Control', 'private, max-age=60'); // 1 минута кэш для карт
      res.json(cards);
    } catch (error) {
      console.error("Ошибка получения карт:", error);
      res.status(500).json({ message: "Ошибка при получении карт" });
    }
  });

  app.get('/api/nft-collections', ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: 'Требуется авторизация' });

      // Добавляем HTTP кэширование для NFT коллекций
      res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600'); // 10 минут кэш
      
      // Добавляем таймаут для Vercel
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('NFT API timeout')), 15000);
      });
      
      const collectionsPromise = (async () => {
        const collections = await db.select().from(nftCollections);
        const collectionsWithNFTs = await Promise.all(collections.map(async (collection) => {
          const collectionNFTs = await db.select().from(nfts).where(eq(nfts.collectionId, collection.id));
          return { ...collection, nfts: collectionNFTs };
        }));
        return collectionsWithNFTs;
      })();
      
      const collectionsWithNFTs = await Promise.race([collectionsPromise, timeoutPromise]);
      res.status(200).json(collectionsWithNFTs);
    } catch (error) {
      console.error('Ошибка при получении коллекций NFT:', error);
      // Возвращаем пустой массив при ошибке вместо 500
      res.status(200).json([]);
    }
  });

  app.get("/api/crypto/seed-phrase", ensureAuthenticated, async (req, res) => {
    try {
      if (!req.user || !req.user.id) return res.status(401).json({ message: "Пользователь не авторизован" });

      const seedPhrase = getSeedPhraseForUser(req.user.id);
      res.json({ seedPhrase });
    } catch (error) {
      console.error("Ошибка генерации seed-фразы:", error);
      res.status(500).json({ message: "Ошибка при генерации seed-фразы" });
    }
  });

  if (process.env.NODE_ENV === 'production') {
    serveStatic(app);
  }

  console.log('✅ Маршруты зарегистрированы для Vercel');
  return createServer(app);
}

export default registerRoutes;
