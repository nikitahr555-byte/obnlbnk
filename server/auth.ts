import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import session from "express-session";
import cookieParser from "cookie-parser";
import { storage } from "./storage.js";
import { User as SelectUser, newUserRegistrationSchema } from "../shared/schema.js";
import { ZodError } from "zod";
import { scrypt, timingSafeEqual } from "crypto";
import crypto from "crypto";
import { promisify } from "util";
import Database from 'better-sqlite3';
import path from 'path';
import { ethers } from 'ethers';
import connectPgSimple from "connect-pg-simple";
import { Pool } from "pg";

declare global {
  namespace Express {
    interface User extends Partial<SelectUser> {
      id?: number;
    }
    interface Session {
      passport?: {
        user?: number;
      };
    }
  }
}

const scryptAsync = promisify(scrypt);

// Асинхронная функция для проверки пароля с использованием scrypt
async function comparePasswordsScrypt(supplied: string, stored: string) {
  const [hashed, salt] = stored.split('.');
  const hashedBuf = Buffer.from(hashed, 'hex');
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Проверка пароля для обычных пользователей (без хеширования)
async function comparePasswords(supplied: string, stored: string) {
  return supplied === stored;
}

// Функция для получения админа из SQLite
async function getAdminFromSqlite(username: string) {
  const dbPath = path.join(process.cwd(), 'sqlite.db');
  const db = new Database(dbPath);
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_regulator = 1').get(username);
    return user || null;
  } finally {
    db.close();
  }
}

export function setupAuth(app: Express) {
  const sessionSecret = process.env.SESSION_SECRET || 'default_secret';
  console.log("Setting up auth with session secret length:", sessionSecret.length);

  app.use(cookieParser());

  const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';

  if (IS_VERCEL) {
    console.log('🔧 Vercel detected: using cookie-only authentication (no express-session store)');

    app.use(session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 дней
        httpOnly: true,
        path: '/'
      },
      name: 'auth.sid'
    }));

  } else {
    console.log('🗄 Using PostgreSQL session store locally');

    const PgStore = connectPgSimple(session);
    const pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    });

    app.use(session({
      store: new PgStore({
        pool: pgPool,
        tableName: "session"
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        path: '/'
      },
      name: 'bnal.sid'
    }));
  }

  // Middleware для отладки сессий
  app.use((req, res, next) => {
    if (req.url.includes('/api/')) {
      console.log('🔍 Session Debug:', {
        sessionID: req.sessionID,
        hasSession: !!req.session,
        sessionData: req.session ? Object.keys(req.session) : [],
        passportUser: (req.session as any)?.passport?.user,
        cookies: req.headers.cookie ? req.headers.cookie.includes('bnal.sid') : false,
        url: req.url,
        method: req.method
      });
    }
    next();
  });

  app.use(passport.initialize());
  app.use(passport.session());

  // Принудительная загрузка пользователя из сессии или cookie
  app.use(async (req, res, next) => {
    if (req.url.includes('/api/') && req.url !== '/api/login' && req.url !== '/api/register') {
      if (!req.user && (req.session as any)?.passport?.user) {
        try {
          const userId = (req.session as any).passport.user;
          const user = await storage.getUser(userId);
          if (user) req.user = user;
        } catch (error) {
          console.error('Error force loading user from session:', error);
        }
      }

      if (!req.user && req.cookies?.user_data) {
        try {
          const userData = JSON.parse(Buffer.from(req.cookies.user_data, 'base64').toString());
          if (Date.now() - userData.timestamp < 7 * 24 * 60 * 60 * 1000) {
            const user = await storage.getUser(userData.id);
            if (user && user.username === userData.username) {
              req.user = user;
              if (!(req.session as any)?.passport) {
                (req.session as any).passport = { user: user.id };
              }
            }
          } else {
            res.clearCookie('user_data');
          }
        } catch (error) {
          console.error('Cookie auth error:', error);
          res.clearCookie('user_data');
        }
      }
    }
    next();
  });

  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      if (username === 'admin') {
        const adminUser = await getAdminFromSqlite(username);
        if (!adminUser) return done(null, false, { message: "Invalid username or password" });
        const isValid = await comparePasswordsScrypt(password, adminUser.password);
        if (!isValid) return done(null, false, { message: "Invalid username or password" });
        return done(null, adminUser);
      }

      const user = await storage.getUserByUsername(username);
      if (!user) return done(null, false, { message: "Invalid username or password" });
      const isValid = await comparePasswords(password, user.password);
      if (!isValid) return done(null, false, { message: "Invalid username or password" });
      return done(null, user);
    } catch (error) {
      console.error("Authentication error:", error);
      return done(error);
    }
  }));

  passport.serializeUser((user: any, done) => {
    const userId = typeof user.id === 'string' ? parseInt(user.id, 10) : user.id;
    done(null, userId);
  });

  passport.deserializeUser(async (id: number, done) => {
    try {
      const userId = typeof id === 'string' ? parseInt(id, 10) : id;
      if (!userId || isNaN(userId)) return done(null, false);
      const user = await storage.getUser(userId);
      if (!user) return done(null, false);
      done(null, user);
    } catch (error) {
      console.error("Deserialization error:", error);
      done(null, false);
    }
  });

  // API Routes
  app.post("/api/register", async (req, res) => {
    let user: SelectUser | null = null;
    try {
      newUserRegistrationSchema.parse(req.body);
      const { username, password } = req.body;
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) return res.status(400).json({ success: false, message: "User exists" });

      user = await storage.createUser({
        username,
        password,
        is_regulator: false,
        regulator_balance: "0",
        nft_generation_count: 0
      });

      await storage.createDefaultCardsForUser(user.id);

      req.login(user, (err) => {
        if (err) return res.status(500).json({ success: false, message: "Login failed after registration" });
        const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
        const userToken = Buffer.from(JSON.stringify({ id: user.id, username: user.username, timestamp: Date.now() })).toString('base64');
        res.cookie('user_data', userToken, { httpOnly: true, secure: IS_VERCEL, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

        if (IS_VERCEL) res.status(201).json(user);
        else req.session.save(() => res.status(201).json(user));
      });

    } catch (error) {
      console.error("Registration error:", error);
      if (user) await storage.deleteUser(user.id);
      res.status(500).json({ success: false, message: "Registration failed" });
    }
  });

  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", (err, user, info) => {
      if (err) return res.status(500).json({ message: "Server error" });
      if (!user) return res.status(401).json({ message: "Invalid credentials" });

      req.logIn(user, (loginErr) => {
        if (loginErr) return res.status(500).json({ message: "Session creation error" });

        const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
        const userToken = Buffer.from(JSON.stringify({ id: user.id, username: user.username, timestamp: Date.now() })).toString('base64');
        res.cookie('user_data', userToken, { httpOnly: true, secure: IS_VERCEL, maxAge: 7 * 24 * 60 * 60 * 1000, sameSite: 'lax' });

        if (IS_VERCEL) res.json(user);
        else req.session.save(() => res.json(user));
      });
    })(req, res, next);
  });

  app.get("/api/user", async (req, res) => {
    if (!req.isAuthenticated() || !req.user) return res.status(401).json({ message: "Not authenticated" });
    const userId = req.user.id;
    const currentUser = await storage.getUser(userId);
    res.json(currentUser || req.user);
  });

  app.post("/api/logout", (req, res) => {
    const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout error" });
      res.clearCookie('user_data');
      res.clearCookie('bnal.sid');
      if (IS_VERCEL) res.sendStatus(200);
      else req.session.destroy(() => res.sendStatus(200));
    });
  });
}
