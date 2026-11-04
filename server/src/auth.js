// Simple single-owner authentication.
// The password is hashed with scrypt and stored in settings. Sessions are
// HMAC-signed tokens (no DB table needed), valid for 30 days.
import crypto from 'node:crypto';
import { getSetting, setSetting, IS_REMOTE } from './db.js';

export const MIN_PASSWORD_LENGTH = IS_REMOTE ? 10 : 4;

// One round trip per cold start instead of one per request.
let secretCache = null;
let passwordHashCache;

async function secret() {
  if (secretCache) return secretCache;
  let s = await getSetting('auth_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    await setSetting('auth_secret', s);
  }
  secretCache = s;
  return s;
}

async function passwordHash() {
  if (passwordHashCache === undefined) passwordHashCache = await getSetting('password_hash');
  return passwordHashCache;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(pw, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  if (hashBuf.length !== 64) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, hashBuf);
}

export async function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 30 * 864e5 })).toString('base64url');
  const sig = crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export async function checkToken(token) {
  if (!token) return false;
  const [payload, sig] = String(token).split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', await secret()).update(payload).digest('base64url');
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch {
    return false;
  }
}

export const isPasswordSet = async () => Boolean(await passwordHash());

export async function requireAuth(req, res, next) {
  try {
    if (!(await isPasswordSet())) {
      // On a shared host an unprotected database is wide open to the internet,
      // so nothing is served until the owner has set a password. The desktop
      // build keeps the old first-run convenience.
      if (IS_REMOTE) {
        return res.status(401).json({ error: 'Set an owner password before using this app.' });
      }
      return next();
    }
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (await checkToken(token)) return next();
    res.status(401).json({ error: 'Unauthorized' });
  } catch (e) {
    next(e);
  }
}

export async function setPassword(pw) {
  const stored = hashPassword(pw);
  await setSetting('password_hash', stored);
  passwordHashCache = stored;
}

export async function currentPasswordHash() {
  return passwordHash();
}

/**
 * Throttles password guessing per client. Serverless instances do not share
 * memory, so this slows a sustained attack rather than stopping one outright —
 * the real protection is the password length rule above.
 */
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function loginThrottle(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = attempts.get(key);
  if (rec && now - rec.first < WINDOW_MS && rec.count >= MAX_ATTEMPTS) {
    const mins = Math.ceil((WINDOW_MS - (now - rec.first)) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute(s).` });
  }
  if (!rec || now - rec.first >= WINDOW_MS) attempts.set(key, { first: now, count: 0 });
  next();
}

export function noteFailedLogin(req) {
  const rec = attempts.get(req.ip || 'unknown');
  if (rec) rec.count += 1;
}

export function clearFailedLogins(req) {
  attempts.delete(req.ip || 'unknown');
}
