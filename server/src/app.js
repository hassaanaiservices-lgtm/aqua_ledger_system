import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { 
  DATA_DIR, db, DB_PATH, getSetting, setSetting, all, migrate, IS_REMOTE, cleanImage,
  reloadDb, PRODUCT_STOCK_SQL, CUSTOMER_BAL_SQL, VENDOR_BAL_SQL
} from './db.js';
import {
  requireAuth, isPasswordSet, verifyPassword, makeToken, setPassword,
  currentPasswordHash, loginThrottle, noteFailedLogin, clearFailedLogins, MIN_PASSWORD_LENGTH,
} from './auth.js';
import { h, bad, today } from './utils.js';
import { buildArchive, importArchive } from './archive.js';
import inventory from './routes/inventory.js';
import parties from './routes/parties.js';
import transactions from './routes/transactions.js';
import assembly from './routes/assembly.js';
import analytics from './routes/analytics.js';
import dayDiary from './routes/dayDiary.js';
import cashbook from './routes/cashbook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ---------- auth (public) ----------
app.get(
  '/api/auth/status',
  h(async () => ({
    password_set: await isPasswordSet(),
    business_name: await getSetting('business_name'),
    min_password_length: MIN_PASSWORD_LENGTH,
  }))
);

app.post(
  '/api/auth/setup',
  h(async (req) => {
    if (await isPasswordSet()) throw bad('Password already configured');
    const pw = String(req.body.password || '');
    if (pw.length < MIN_PASSWORD_LENGTH) throw bad(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    await setPassword(pw);
    return { token: await makeToken() };
  })
);

app.post(
  '/api/auth/login',
  loginThrottle,
  h(async (req, res) => {
    if (!(await isPasswordSet())) return { token: await makeToken() };
    if (!verifyPassword(String(req.body.password || ''), await currentPasswordHash())) {
      noteFailedLogin(req);
      res.status(401);
      return { error: 'Incorrect password' };
    }
    clearFailedLogins(req);
    return { token: await makeToken() };
  })
);

// ---------- protected API ----------
app.use('/api', requireAuth);

app.post(
  '/api/auth/change-password',
  h(async (req) => {
    if ((await isPasswordSet()) && !verifyPassword(String(req.body.current || ''), await currentPasswordHash()))
      throw bad('Current password is incorrect');
    const pw = String(req.body.password || '');
    if (pw.length < MIN_PASSWORD_LENGTH) throw bad(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    await setPassword(pw);
    return { token: await makeToken() };
  })
);

const PUBLIC_SETTINGS = ['business_name', 'business_tagline', 'business_logo', 'business_address', 'business_phone', 'business_email', 'business_ntn', 'invoice_footer', 'invoice_terms', 'currency'];
const publicSettings = async () =>
  Object.fromEntries(await Promise.all(PUBLIC_SETTINGS.map(async (k) => [k, await getSetting(k, '')])));
app.get('/api/settings', h(publicSettings));
app.put(
  '/api/settings',
  h(async (req) => {
    for (const k of PUBLIC_SETTINGS) {
      if (!(k in req.body)) continue;
      await setSetting(k, k === 'business_logo' ? cleanImage(req.body[k], 'Logo') : req.body[k]);
    }
    return publicSettings();
  })
);

// Full database backup download (single SQLite file). Only the desktop build
// has a file to hand over; on a hosted database the JSON export below is the
// equivalent, so say that plainly instead of sending a broken download.
app.get('/api/backup', async (req, res, next) => {
  try {
    if (IS_REMOTE) {
      throw bad('This copy runs on a hosted database. Use "Download master data (JSON)" instead.');
    }
    await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
    res.download(DB_PATH, `business-backup-${today()}.db`);
  } catch (e) {
    next(e);
  }
});

// Complete JSON archive: every record, in a form that can be loaded back into
// any copy of the app — desktop or hosted. This is the one backup that travels.
app.get('/api/backup/readable', async (req, res, next) => {
  try {
    const archive = await buildArchive();
    res.setHeader('Content-Disposition', `attachment; filename="aqua-archive-${today()}.json"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.send(JSON.stringify(archive, null, 2));
  } catch (e) {
    next(e);
  }
});

// Load a JSON archive back in, replacing everything. Works on the hosted
// database too, which the .db upload below cannot do.
app.post(
  '/api/backup/import',
  h(async (req) => {
    const archive = req.body;
    if (!archive?.confirm) throw bad('Confirmation required before replacing the current data.');
    const imported = await importArchive(archive);
    const total = Object.values(imported).reduce((a, n) => a + n, 0);
    return { success: true, imported, total };
  })
);

// Restore database from uploaded .db file
app.post('/api/backup/restore', express.raw({ type: '*/*', limit: '150mb' }), async (req, res, next) => {
  try {
    if (IS_REMOTE) {
      throw bad('Restoring a .db file only works in the desktop app, not on a hosted database.');
    }
    const buf = req.body;
    if (!buf || buf.length < 100) {
      throw bad('Uploaded file is empty or corrupted');
    }
    const magic = buf.subarray(0, 15).toString();
    if (magic !== 'SQLite format 3') {
      throw bad('Invalid file format. Please upload a valid Aqua Home Appliance SQLite database (.db) file.');
    }

    // 1. Create a safety snapshot of the existing database before replacing
    const backupDir = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    try {
      await db.execute('PRAGMA wal_checkpoint(TRUNCATE)');
      const stamp = Date.now();
      fs.copyFileSync(DB_PATH, path.join(backupDir, `safety-pre-restore-${stamp}.db`));
    } catch (e) {
      console.warn('Could not take pre-restore safety snapshot:', e);
    }

    // 2. Release the current connection before the file underneath it changes
    try { db.close(); } catch { /* already closed */ }

    const wal = DB_PATH + '-wal';
    const shm = DB_PATH + '-shm';
    if (fs.existsSync(wal)) try { fs.unlinkSync(wal); } catch {}
    if (fs.existsSync(shm)) try { fs.unlinkSync(shm); } catch {}

    // 3. Write new file and reload connection
    fs.writeFileSync(DB_PATH, buf);
    reloadDb();

    res.json({ success: true, message: 'Database successfully restored and reloaded.' });
  } catch (e) {
    try { reloadDb(); } catch {}
    next(e);
  }
});

// System storage status & backups
app.get('/api/system/storage', h(async () => {
  if (IS_REMOTE) return { hosted: true, data_dir: null, db_path: null, is_safe_location: true, backups: [], last_backup: null };
  const backupDir = path.join(DATA_DIR, 'backups');
  let backups = [];
  if (fs.existsSync(backupDir)) {
    backups = fs.readdirSync(backupDir)
      .filter((f) => f.startsWith('business-backup-') && f.endsWith('.db'))
      .map((name) => {
        const full = path.join(backupDir, name);
        const st = fs.statSync(full);
        return {
          name,
          size_kb: Math.round(st.size / 1024),
          created_at: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
  const is_safe = DATA_DIR.toUpperCase().startsWith('D:') ||
                  DATA_DIR.toUpperCase().startsWith('E:') ||
                  DATA_DIR.toUpperCase().includes('AQUAHOMEDATA');
  return {
    data_dir: DATA_DIR,
    db_path: DB_PATH,
    is_safe_location: is_safe,
    backups,
    last_backup: backups[0]?.created_at || null,
  };
}));

app.post('/api/system/create-backup', h(async () => {
  if (IS_REMOTE) throw bad('Local snapshots are a desktop feature. Use the JSON export to keep a copy.');
  const backupDir = path.join(DATA_DIR, 'backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  const backupName = `business-backup-${stamp}.db`;
  const backupFile = path.join(backupDir, backupName);
  fs.copyFileSync(DB_PATH, backupFile);
  const st = fs.statSync(backupFile);
  return {
    success: true,
    backup: {
      name: backupName,
      size_kb: Math.round(st.size / 1024),
      created_at: st.mtime.toISOString(),
    },
  };
}));

app.post('/api/system/open-folder', h(async () => {
  if (IS_REMOTE) throw bad('There is no local data folder when the app runs on a hosted database.');
  if (process.platform === 'win32') {
    exec(`explorer.exe "${DATA_DIR}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${DATA_DIR}"`);
  } else {
    exec(`xdg-open "${DATA_DIR}"`);
  }
  return { success: true };
}));

app.get('/api/lookups', h(async () => ({
  customers: await all('SELECT id, name, phone FROM customers ORDER BY name'),
  vendors: await all('SELECT id, name, phone FROM vendors ORDER BY name'),
  products: await all('SELECT id, name, sku, type, unit, sale_price, cost_price FROM products WHERE active = 1 ORDER BY name'),
  bank_accounts: await all('SELECT id, name, owner_name, bank_name FROM bank_accounts WHERE active = 1 ORDER BY sort, id'),
})));

app.use('/api', inventory);
app.use('/api', parties);
app.use('/api', transactions);
app.use('/api', assembly);
app.use('/api', analytics);
app.use('/api', dayDiary);
app.use('/api', cashbook);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- serve built client in production ----------
const dist = process.env.CLIENT_DIST || path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// ---------- errors ----------
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error' });
});

export default app;
