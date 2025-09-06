import session from "express-session";
import { db, client } from "./db.js";
import { cards, users, transactions, exchangeRates, nftCollections, nfts } from "../shared/schema.js";
import type { 
  User, Card, InsertUser, Transaction, ExchangeRate,
  NftCollection, Nft, InsertNftCollection, InsertNft
} from "../shared/schema.js";
import { eq, or, desc, inArray } from "drizzle-orm";
import { generateValidAddress, validateCryptoAddress } from './utils/crypto.js';
import pgSession from 'connect-pg-simple';
import NodeCache from 'node-cache';

const PostgresStore = pgSession(session);

// Кэш на 30 секунд для часто запрашиваемых данных
const cache = new NodeCache({ stdTTL: 30, checkperiod: 60 });

const DATABASE_URL = process.env.DATABASE_URL;
const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
const DB_TIMEOUT = IS_VERCEL ? 20000 : 15000; // 20 сек на Vercel

// Таймаут для любых DB операций
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number = DB_TIMEOUT): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Database operation timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]);
}

export class DatabaseStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = IS_VERCEL
      ? new PostgresStore({
          conObject: {
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false },
          },
          tableName: 'session',
          createTableIfMissing: true,
          pruneSessionInterval: 60 * 15,
        })
      : new PostgresStore({
          conObject: {
            connectionString: DATABASE_URL,
            ssl: { rejectUnauthorized: false },
          },
          tableName: 'session',
          createTableIfMissing: true,
          pruneSessionInterval: 60 * 15,
        });
    console.log('Session store initialized');
  }

  private async withRetry<T>(operation: () => Promise<T>, operationName: string, maxRetries: number = 3): Promise<T> {
    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        return await withTimeout(operation(), DB_TIMEOUT);
      } catch (error) {
        attempt++;
        console.error(`${operationName} failed on attempt ${attempt}:`, error);
        if (attempt >= maxRetries) throw error;
        const delay = IS_VERCEL ? 200 : Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error(`${operationName} failed after ${maxRetries} attempts`);
  }

  async getUser(id: number): Promise<User | undefined> {
    const cacheKey = `user_${id}`;
    const cached = cache.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.withRetry(async () => {
      const [u] = await db.select().from(users).where(eq(users.id, id));
      return u;
    }, 'Get user');

    if (user) cache.set(cacheKey, user);
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const cacheKey = `user_name_${username}`;
    const cached = cache.get<User>(cacheKey);
    if (cached) return cached;

    const user = await this.withRetry(async () => {
      const [u] = await db.select().from(users).where(eq(users.username, username));
      return u;
    }, 'Get user by username');

    if (user) cache.set(cacheKey, user);
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return this.withRetry(async () => {
      const [user] = await db.insert(users).values(insertUser).returning();
      return user;
    }, 'Create user');
  }

  async getCardsByUserId(userId: number): Promise<Card[]> {
    const cacheKey = `cards_${userId}`;
    const cached = cache.get<Card[]>(cacheKey);
    if (cached) return cached;

    const cardsList = await this.withRetry(async () => {
      return await db.select().from(cards).where(eq(cards.userId, userId));
    }, 'Get cards by user ID');

    cache.set(cacheKey, cardsList);
    return cardsList;
  }

  async createCard(card: Omit<Card, "id">): Promise<Card> {
    return this.withRetry(async () => {
      const [result] = await db.insert(cards).values(card).returning();
      return result;
    }, 'Create card');
  }

  async updateCardBalance(cardId: number, balance: string) {
    await this.withRetry(async () => {
      await db.update(cards).set({ balance }).where(eq(cards.id, cardId));
      cache.del(`cards_${cardId}`);
    }, 'Update card balance');
  }

  async updateCardBtcBalance(cardId: number, balance: string) {
    await this.withRetry(async () => {
      await db.update(cards).set({ btcBalance: balance }).where(eq(cards.id, cardId));
    }, 'Update BTC balance');
  }

  async updateCardEthBalance(cardId: number, balance: string) {
    await this.withRetry(async () => {
      await db.update(cards).set({ ethBalance: balance }).where(eq(cards.id, cardId));
    }, 'Update ETH balance');
  }

  async getCardById(cardId: number): Promise<Card | undefined> {
    return this.withRetry(async () => {
      const [c] = await db.select().from(cards).where(eq(cards.id, cardId));
      return c;
    }, 'Get card by ID');
  }

  async getCardByNumber(cardNumber: string): Promise<Card | undefined> {
    return this.withRetry(async () => {
      const [c] = await db.select().from(cards).where(eq(cards.number, cardNumber));
      return c;
    }, 'Get card by number');
  }

  async getTransactionsByCardId(cardId: number): Promise<Transaction[]> {
    return this.withRetry(async () => {
      return await db.select()
        .from(transactions)
        .where(or(eq(transactions.fromCardId, cardId), eq(transactions.toCardId, cardId)))
        .orderBy(desc(transactions.createdAt));
    }, 'Get transactions by card ID');
  }

  async createTransaction(transaction: Omit<Transaction, "id">): Promise<Transaction> {
    return this.withRetry(async () => {
      const [t] = await db.insert(transactions).values(transaction).returning();
      return t;
    }, 'Create transaction');
  }

  // Пример функции перевода денег
  async transferMoney(fromCardId: number, toCardNumber: string, amount: number) {
    return this.withRetry(async () => {
      const fromCard = await this.getCardById(fromCardId);
      if (!fromCard) return { success: false, error: 'Карта отправителя не найдена' };

      const toCard = await this.getCardByNumber(toCardNumber);
      if (!toCard) return { success: false, error: 'Карта получателя не найдена' };

      const fromBalance = parseFloat(fromCard.balance);
      if (fromBalance < amount) return { success: false, error: 'Недостаточно средств' };

      const toBalance = parseFloat(toCard.balance);
      await this.updateCardBalance(fromCardId, (fromBalance - amount).toString());
      await this.updateCardBalance(toCard.id, (toBalance + amount).toString());

      const transaction = await this.createTransaction({
        fromCardId,
        toCardId: toCard.id,
        amount: amount.toString(),
        convertedAmount: amount.toString(),
        type: "transfer",
        wallet: null,
        status: "completed",
        description: `Перевод с карты ${fromCard.number} на карту ${toCard.number}`,
        fromCardNumber: fromCard.number,
        toCardNumber: toCard.number,
        createdAt: new Date()
      });

      return { success: true, transaction };
    }, 'Transfer money');
  }

  // Другие методы аналогично с таймаутом и кэшем...
}

// Export singleton instance
export const storage = new DatabaseStorage();
