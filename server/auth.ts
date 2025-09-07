import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Express } from "express";
import cookieParser from "cookie-parser";
import { storage } from "./storage.js";
import { withDatabaseRetry } from "./db.js";
import { User as SelectUser, newUserRegistrationSchema } from "../shared/schema.js";
import { ZodError } from "zod";
import { scrypt, timingSafeEqual } from "crypto";
import { promisify } from "util";
import crypto from "crypto";

// Асинхронная проверка пароля с scrypt
const scryptAsync = promisify(scrypt);
async function comparePasswordsScrypt(supplied: string, stored: string) {
  const [hashed, salt] = stored.split('.');
  const hashedBuf = Buffer.from(hashed, 'hex');
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

// Обычная проверка пароля
async function comparePasswords(supplied: string, stored: string) {
  return supplied === stored;
}

declare global {
  namespace Express {
    interface User extends Partial<SelectUser> {
      id?: number;
    }
  }
}

export function setupAuth(app: Express) {
  const IS_VERCEL = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const SESSION_SECRET = process.env.SESSION_SECRET || "default_secret";

  app.use(cookieParser());

  // Passport init (без MemoryStore для Vercel)
  app.use(passport.initialize());

  // Middleware: проверка cookie и установка req.user для Vercel с fallback
  app.use(async (req, res, next) => {
    if (IS_VERCEL && !req.user && req.cookies?.user_data) {
      try {
        const userData = JSON.parse(Buffer.from(req.cookies.user_data, 'base64').toString());
        // Токен валиден 7 дней
        if (Date.now() - userData.timestamp < 7 * 24 * 60 * 60 * 1000) {
          try {
            const user = await withDatabaseRetry(
              () => storage.getUser(userData.id),
              2,
              'Auth middleware user lookup'
            );
            if (user && user.username === userData.username) {
              req.user = user;
            } else {
              res.clearCookie('user_data');
            }
          } catch (dbError) {
            console.error('DB error in auth middleware, using fallback:', dbError);
            // Fallback: используем данные из cookie без проверки БД
            if (userData.id && userData.username) {
              req.user = { id: userData.id, username: userData.username };
            }
          }
        } else {
          res.clearCookie('user_data');
        }
      } catch {
        res.clearCookie('user_data');
      }
    }
    next();
  });

  // LocalStrategy с улучшенной обработкой ошибок и fallback механизмом
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      const user = await withDatabaseRetry(
        () => storage.getUserByUsername(username),
        3,
        'LocalStrategy user lookup'
      );
      if (!user) return done(null, false, { message: 'Неверные учетные данные' });

      const valid = await comparePasswords(password, user.password);
      if (!valid) return done(null, false, { message: 'Неверные учетные данные' });

      return done(null, user);
    } catch (err) {
      console.error('LocalStrategy DB error:', err);
      
      // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Fallback для демо доступа при проблемах с БД
      if (username === 'demo' && password === 'demo') {
        const fallbackUser = {
          id: 999,
          username: 'demo',
          password: 'demo',
          is_regulator: false,
          regulator_balance: '0',
          nft_generation_count: 0,
          last_nft_generation: null
        };
        console.log('🚨 Используем fallback авторизацию для demo пользователя');
        return done(null, fallbackUser);
      }
      
      // Возвращаем более понятную ошибку пользователю
      return done(null, false, { message: 'Временные проблемы с сервером. Попробуйте позже.' });
    }
  }));

  passport.serializeUser((user: any, done) => done(null, user.id));
  passport.deserializeUser(async (id: number, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user || false);
    } catch {
      done(null, false);
    }
  });

  // Регистрация
  app.post("/api/register", async (req, res) => {
    try {
      newUserRegistrationSchema.parse(req.body);
      const { username, password } = req.body;

      const exists = await storage.getUserByUsername(username);
      if (exists) return res.status(400).json({ message: "Пользователь уже существует" });

      const user = await storage.createUser({ username, password, is_regulator: false, regulator_balance: "0", nft_generation_count: 0 });

      // Cookie-based auth для Vercel
      if (IS_VERCEL) {
        const token = Buffer.from(JSON.stringify({ id: user.id, username: user.username, timestamp: Date.now() })).toString("base64");
        res.cookie("user_data", token, { httpOnly: true, secure: true, maxAge: 7*24*60*60*1000, sameSite: "lax" });
      }

      res.status(201).json(user);
    } catch (err) {
      if (err instanceof ZodError) return res.status(400).json({ message: err.errors[0]?.message || "Ошибка валидации" });
      res.status(500).json({ message: "Ошибка регистрации" });
    }
  });

  // Login
  app.post("/api/login", (req, res, next) => {
    passport.authenticate("local", async (err: any, user: any, info: any) => {
      if (err) return res.status(500).json({ message: "Ошибка сервера" });
      if (!user) return res.status(401).json({ message: info?.message || "Неверные данные" });

      if (IS_VERCEL) {
        const token = Buffer.from(JSON.stringify({ id: user.id, username: user.username, timestamp: Date.now() })).toString("base64");
        res.cookie("user_data", token, { httpOnly: true, secure: true, maxAge: 7*24*60*60*1000, sameSite: "lax" });
        return res.json(user);
      } else {
        req.logIn(user, (loginErr: any) => {
          if (loginErr) return res.status(500).json({ message: "Ошибка сессии" });
          res.json(user);
        });
      }
    })(req, res, next);
  });

  // Logout
  app.post("/api/logout", (req, res) => {
    res.clearCookie("user_data");
    if (!IS_VERCEL && req.logout) req.logout(() => {});
    res.sendStatus(200);
  });

  // Проверка текущего пользователя
  app.get("/api/user", (req, res) => {
    if (!req.user) return res.status(401).json({ message: "Не авторизован" });
    res.json(req.user);
  });
}
