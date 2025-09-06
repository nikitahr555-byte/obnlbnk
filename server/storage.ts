import session from "express-session";
import { db, client } from "./db.js";
import { cards, users, transactions, exchangeRates, nftCollections, nfts } from "../shared/schema.js";
import type { 
  User, Card, InsertUser, Transaction, ExchangeRate,
  NftCollection, Nft, InsertNftCollection, InsertNft
} from "../shared/schema.js";
import { eq, and, or, desc, inArray } from "drizzle-orm";
import { randomUUID } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { generateValidAddress, validateCryptoAddress } from './utils/crypto.js';
import { 
  sendBitcoinTransaction, sendEthereumTransaction,
  getBitcoinBalance, getEthereumBalance
} from './utils/blockchain.js';
import NodeCache from "node-cache";
// КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Убрали PostgreSQL сессии чтобы не создавать лишние соединения
// import pgSession from 'connect-pg-simple';
import MemoryStore from 'memorystore';

// ИСПРАВЛЕНИЕ: Используем MemoryStore вместо PostgreSQL для сессий
const MemStore = MemoryStore(session);
console.log('🆘 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Используем MemoryStore для сессий вместо PostgreSQL');

// Настройка кэша для часто используемых запросов
const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 }); // 10 минут кэш для максимальной производительности

// РАДИКАЛЬНОЕ ИСПРАВЛЕНИЕ: Увеличиваем все таймауты для Vercel
const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const DB_TIMEOUT = IS_VERCEL ? 50000 : 15000; // УВЕЛИЧИЛИ до 50 секунд для Vercel
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000;

// Универсальная функция с ретраями и увеличенными таймаутами
async function withRetryAndTimeout<T>(
  operation: () => Promise<T>, 
  operationName: string = 'Database operation',
  maxRetries: number = MAX_RETRIES,
  timeoutMs: number = DB_TIMEOUT
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`${operationName} timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      
      console.log(`🔄 [VERCEL] ${operationName} - попытка ${attempt}/${maxRetries}`);
      const result = await Promise.race([operation(), timeoutPromise]);
      console.log(`✅ [VERCEL] ${operationName} - успешно на попытке ${attempt}`);
      return result;
    } catch (error) {
      console.error(`❌ [VERCEL] ${operationName} неудача на попытке ${attempt}:`, error);
      
      if (attempt === maxRetries) {
        console.error(`💥 [VERCEL] ${operationName} исчерпаны все ${maxRetries} попытки, выбрасываем ошибку`);
        throw error;
      }
      
      console.log(`⏳ [VERCEL] Ждем ${RETRY_DELAY}ms перед следующей попыткой...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt)); // Экспоненциальный бэкофф
    }
  }
  throw new Error(`Все попытки ${operationName} исчерпаны`);
}

// Обратная совместимость
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = DB_TIMEOUT): Promise<T> {
  return withRetryAndTimeout(() => promise, 'Legacy operation', 1, timeoutMs);
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getCardsByUserId(userId: number): Promise<Card[]>;
  createCard(card: Omit<Card, "id">): Promise<Card>;
  sessionStore: session.Store;
  getAllUsers(): Promise<User[]>;
  updateRegulatorBalance(userId: number, balance: string): Promise<void>;
  updateCardBalance(cardId: number, balance: string): Promise<void>;
  updateCardBtcBalance(cardId: number, balance: string): Promise<void>;
  updateCardEthBalance(cardId: number, balance: string): Promise<void>;
  getCardById(cardId: number): Promise<Card | undefined>;
  getCardByNumber(cardNumber: string): Promise<Card | undefined>;
  getTransactionsByCardId(cardId: number): Promise<Transaction[]>;
  createTransaction(transaction: Omit<Transaction, "id">): Promise<Transaction>;
  transferMoney(fromCardId: number, toCardNumber: string, amount: number): Promise<{ success: boolean; error?: string; transaction?: Transaction }>;
  transferCrypto(fromCardId: number, recipientAddress: string, amount: number, cryptoType: 'btc' | 'eth'): Promise<{ success: boolean; error?: string; transaction?: Transaction }>;
  getLatestExchangeRates(): Promise<ExchangeRate | undefined>;
  updateExchangeRates(rates: { usdToUah: number; btcToUsd: number; ethToUsd: number }): Promise<ExchangeRate>;
  createNFTCollection(userId: number, name: string, description: string): Promise<NftCollection>;
  createNFT(data: InsertNft): Promise<Nft>;
  getNFTsByUserId(userId: number): Promise<Nft[]>;
  getNFTCollectionsByUserId(userId: number): Promise<NftCollection[]>;
  canGenerateNFT(userId: number): Promise<boolean>;
  updateUserNFTGeneration(userId: number): Promise<void>;
  getTransactionsByCardIds(cardIds: number[]): Promise<Transaction[]>;
  createDefaultCardsForUser(userId: number): Promise<void>;
  deleteUser(userId: number): Promise<void>;
  executeRawQuery(query: string): Promise<any>;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Используем MemoryStore вместо PostgreSQL сессий
    // Это убирает одно лишнее соединение с PostgreSQL
    this.sessionStore = new MemStore({
      checkPeriod: 86400000, // prune expired entries every 24h
      max: 10000, // максимум 10K сессий в памяти
      ttl: 7 * 24 * 60 * 60 * 1000, // 7 дней в миллисекундах
      dispose: (key: string) => {
        console.log('Session expired:', key);
      }
    });
    console.log('✅ Session store инициализирован с MemoryStore (НЕ PostgreSQL)');
  }

  private async withRetry<T>(operation: () => Promise<T>, operationName: string, maxRetries = 3): Promise<T> {
    return withRetryAndTimeout(operation, operationName, maxRetries);
  }

  // === Пользователи ===
  async getUser(id: number): Promise<User | undefined> {
    const cacheKey = `user_${id}`;
    const cached = cache.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.withRetry(async () => {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      return u;
    }, 'getUser');

    if (user) {
      // Агрессивное кэширование пользователей на 20 минут
      cache.set(cacheKey, user, 1200);
    }
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const cacheKey = `user_name_${username}`;
    const cached = cache.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.withRetry(async () => {
      const [u] = await db.select().from(users).where(eq(users.username, username));
      return u;
    }, 'getUserByUsername');

    if (user) {
      // Кэшируем и по ID и по username для быстрого доступа
      cache.set(cacheKey, user, 1200); // 20 минут
      cache.set(`user_${user.id}`, user, 1200);
    }
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    return this.withRetry(async () => {
      const [u] = await db.insert(users).values(user).returning();
      return u;
    }, 'createUser');
  }

  async getAllUsers(): Promise<User[]> {
    return this.withRetry(() => db.select().from(users), 'getAllUsers');
  }

  async deleteUser(userId: number): Promise<void> {
    return this.withRetry(async () => {
      await db.delete(cards).where(eq(cards.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
      cache.del(`user_${userId}`);
    }, 'deleteUser');
  }

  async updateRegulatorBalance(userId: number, balance: string) {
    return this.withRetry(async () => {
      await db.update(users).set({ regulator_balance: balance }).where(eq(users.id, userId));
    }, 'updateRegulatorBalance');
  }

  // === Карты ===
  async getCardsByUserId(userId: number): Promise<Card[]> {
    const cacheKey = `cards_${userId}`;
    const cached = cache.get<Card[]>(cacheKey);
    if (cached) return cached;

    const cardsList = await this.withRetry(async () => {
      return await db.select().from(cards).where(eq(cards.userId, userId));
    }, 'getCardsByUserId');

    cache.set(cacheKey, cardsList);
    return cardsList;
  }

  async createCard(card: Omit<Card, "id">): Promise<Card> {
    return this.withRetry(async () => {
      const [c] = await db.insert(cards).values(card).returning();
      cache.del(`cards_${card.userId}`);
      return c;
    }, 'createCard');
  }

  async getCardById(cardId: number): Promise<Card | undefined> {
    return this.withRetry(async () => {
      const [c] = await db.select().from(cards).where(eq(cards.id, cardId));
      return c;
    }, 'getCardById');
  }

  async getCardByNumber(cardNumber: string): Promise<Card | undefined> {
    return this.withRetry(async () => {
      const [c] = await db.select().from(cards).where(eq(cards.number, cardNumber));
      return c;
    }, 'getCardByNumber');
  }

  async updateCardBalance(cardId: number, balance: string) {
    return this.withRetry(async () => {
      await db.update(cards).set({ balance }).where(eq(cards.id, cardId));
    }, 'updateCardBalance');
  }

  async updateCardBtcBalance(cardId: number, balance: string) {
    return this.withRetry(async () => {
      await db.update(cards).set({ btcBalance: balance }).where(eq(cards.id, cardId));
    }, 'updateCardBtcBalance');
  }

  async updateCardEthBalance(cardId: number, balance: string) {
    return this.withRetry(async () => {
      await db.update(cards).set({ ethBalance: balance }).where(eq(cards.id, cardId));
    }, 'updateCardEthBalance');
  }

  // === Транзакции ===
  async getTransactionsByCardId(cardId: number): Promise<Transaction[]> {
    return this.withRetry(() => db.select().from(transactions)
      .where(or(eq(transactions.fromCardId, cardId), eq(transactions.toCardId, cardId)))
      .orderBy(desc(transactions.createdAt)), 'getTransactionsByCardId');
  }

  async createTransaction(transaction: Omit<Transaction, "id">): Promise<Transaction> {
    return this.withRetry(async () => {
      const [t] = await db.insert(transactions).values(transaction).returning();
      return t;
    }, 'createTransaction');
  }

  async getTransactionsByCardIds(cardIds: number[]): Promise<Transaction[]> {
    if (!cardIds.length) return [];
    return this.withRetry(() => db.select().from(transactions)
      .where(or(inArray(transactions.fromCardId, cardIds), inArray(transactions.toCardId, cardIds)))
      .orderBy(desc(transactions.createdAt)), 'getTransactionsByCardIds');
  }

  // === Переводы ===
  async transferMoney(fromCardId: number, toCardNumber: string, amount: number) {
    return this.withRetry(async () => {
      const fromCard = await this.getCardById(fromCardId);
      if (!fromCard) return { success: false, error: 'Карта отправителя не найдена' };
      const toCard = await this.getCardByNumber(toCardNumber);
      if (!toCard) return { success: false, error: 'Карта получателя не найдена' };
      if (parseFloat(fromCard.balance) < amount) return { success: false, error: 'Недостаточно средств' };

      await this.updateCardBalance(fromCardId, (parseFloat(fromCard.balance) - amount).toString());
      await this.updateCardBalance(toCard.id, (parseFloat(toCard.balance) + amount).toString());

      const transaction = await this.createTransaction({
        fromCardId, toCardId: toCard.id, amount: amount.toString(),
        convertedAmount: amount.toString(), type: "transfer", wallet: null,
        status: "completed",
        description: `Перевод с карты ${fromCard.number} на карту ${toCard.number}`,
        fromCardNumber: fromCard.number, toCardNumber: toCard.number,
        createdAt: new Date()
      });

      return { success: true, transaction };
    }, 'transferMoney');
  }

  async transferCrypto(fromCardId: number, recipientAddress: string, amount: number, cryptoType: 'btc'|'eth') {
    return this.withRetry(async () => {
      const fromCard = await this.getCardById(fromCardId);
      if (!fromCard) return { success: false, error: 'Карта отправителя не найдена' };
      if (!validateCryptoAddress(recipientAddress, cryptoType)) return { success: false, error: 'Неверный адрес' };

      const currentBalance = cryptoType === 'btc' ? parseFloat(fromCard.btcBalance) : parseFloat(fromCard.ethBalance);
      if (currentBalance < amount) return { success: false, error: 'Недостаточно средств' };

      const newBalance = (currentBalance - amount).toString();
      if (cryptoType === 'btc') await this.updateCardBtcBalance(fromCardId, newBalance);
      else await this.updateCardEthBalance(fromCardId, newBalance);

      const transaction = await this.createTransaction({
        fromCardId, toCardId: null, amount: amount.toString(), convertedAmount: amount.toString(),
        type: cryptoType === 'btc' ? 'bitcoin_transfer' : 'ethereum_transfer',
        wallet: recipientAddress, status: 'completed',
        description: `Перевод ${amount} ${cryptoType.toUpperCase()} на адрес ${recipientAddress}`,
        fromCardNumber: fromCard.number, toCardNumber: null,
        createdAt: new Date()
      });

      return { success: true, transaction };
    }, 'transferCrypto');
  }

  // === Курсы ===
  async getLatestExchangeRates(): Promise<ExchangeRate|undefined> {
    const cached = cache.get<ExchangeRate>('rates');
    if (cached) return cached;

    const rates = await this.withRetry(() => db.select().from(exchangeRates).orderBy(desc(exchangeRates.updatedAt)).limit(1), 'getLatestExchangeRates');
    const [firstRate] = rates;
    if (firstRate) {
      // Кэшируем на 10 минут для курсов валют
      cache.set('rates', firstRate, 600);
    }
    return firstRate;
  }

  async updateExchangeRates(rates: { usdToUah: number; btcToUsd: number; ethToUsd: number }): Promise<ExchangeRate> {
    return this.withRetry(async () => {
      const [r] = await db.insert(exchangeRates).values({
        usdToUah: rates.usdToUah.toString(),
        btcToUsd: rates.btcToUsd.toString(),
        ethToUsd: rates.ethToUsd.toString(),
        updatedAt: new Date()
      }).returning();
      cache.set('rates', r);
      return r;
    }, 'updateExchangeRates');
  }

  // === NFT ===
  async createNFTCollection(userId: number, name: string, description: string) {
    return this.withRetry(async () => {
      const [collection] = await db.insert(nftCollections).values({ userId, name, description, coverImage: null, createdAt: new Date() }).returning();
      return collection;
    }, 'createNFTCollection');
  }

  async createNFT(data: InsertNft) {
    return this.withRetry(async () => {
      const [nft] = await db.insert(nfts).values(data).returning();
      return nft;
    }, 'createNFT');
  }

  async getNFTsByUserId(userId: number) {
    return this.withRetry(async () => db.select().from(nfts).where(eq(nfts.ownerId, userId)).orderBy(desc(nfts.mintedAt)), 'getNFTsByUserId');
  }

  async getNFTCollectionsByUserId(userId: number) {
    return this.withRetry(async () => db.select().from(nftCollections).where(eq(nftCollections.userId, userId)).orderBy(desc(nftCollections.createdAt)), 'getNFTCollectionsByUserId');
  }

  async canGenerateNFT(userId: number) {
    return this.withRetry(async () => {
      const user = await this.getUser(userId);
      if (!user) return false;
      if (!user.last_nft_generation) return true;
      const hoursDiff = (new Date().getTime() - user.last_nft_generation.getTime()) / 1000 / 3600;
      return hoursDiff >= 24 && user.nft_generation_count < 3;
    }, 'canGenerateNFT');
  }

  async updateUserNFTGeneration(userId: number) {
    return this.withRetry(async () => {
      const user = await this.getUser(userId);
      if (!user) throw new Error('User not found');
      await db.update(users).set({ last_nft_generation: new Date(), nft_generation_count: user.nft_generation_count + 1 }).where(eq(users.id, userId));
    }, 'updateUserNFTGeneration');
  }

  async createDefaultCardsForUser(userId: number) {
    return this.withRetry(async () => {
      const btcAddress = await generateValidAddress('btc', userId);
      const ethAddress = await generateValidAddress('eth', userId);

      const virtualCard = await this.createCard({
        userId, type: 'virtual', number: this.generateCardNumber(), expiry: this.generateExpiryDate(),
        cvv: this.generateCVV(), balance: '1000', btcBalance: '0', ethBalance: '0', kichcoinBalance: '100',
        btcAddress: null, ethAddress: null, tonAddress: null
      });

      const cryptoCard = await this.createCard({
        userId, type: 'crypto', number: this.generateCardNumber(), expiry: this.generateExpiryDate(),
        cvv: this.generateCVV(), balance: '0', btcBalance: '0.001', ethBalance: '0.01', kichcoinBalance: '50',
        btcAddress, ethAddress, tonAddress: null
      });

      console.log(`Created virtual card ${virtualCard.id} and crypto card ${cryptoCard.id} for user ${userId}`);
    }, 'createDefaultCardsForUser');
  }

  async executeRawQuery(query: string) {
    // ИСПРАВЛЕНИЕ: Используем обычный postgres клиент для Supabase
    return this.withRetry(() => client.unsafe(query), 'executeRawQuery');
  }

  private generateCardNumber() { return Array.from({length:16},()=>Math.floor(Math.random()*10)).join(''); }
  private generateExpiryDate() { const d=new Date();return `${(d.getMonth()+1).toString().padStart(2,'0')}/${(d.getFullYear()+4).toString().slice(-2)}`; }
  private generateCVV() { return Math.floor(100+Math.random()*900).toString(); }
}

// Экспортируем синглтон
export const storage = new DatabaseStorage();
