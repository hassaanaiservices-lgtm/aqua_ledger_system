// Database layer: schema, helpers and derived-value calculations.
// Design principle: balances and stock are NEVER stored as editable numbers.
// They are always derived from the transaction tables, so every figure can be
// traced back to its source document (sale, purchase, payment, assembly, adjustment).
import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpError } from './utils.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
export const DB_PATH = path.join(DATA_DIR, 'business.db');

/**
 * One client for both worlds: a local SQLite file for the desktop build, or a
 * Turso database when DATABASE_URL is set. The SQL is identical either way, so
 * the books behave the same whichever the app is running against.
 */
// A file: URL is still a local database, however it was pointed at.
export const IS_REMOTE = Boolean(process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith('file:'));
if (!process.env.DATABASE_URL) fs.mkdirSync(DATA_DIR, { recursive: true });

// The default export drags in libSQL's native binary, which has no place in a
// serverless bundle. Talking to Turso only needs the pure-JS fetch client.
const { createClient } = IS_REMOTE
  ? await import('@libsql/client/web')
  : await import('@libsql/client');

export let db = createClient({
  url: process.env.DATABASE_URL || `file:${DB_PATH}`,
  authToken: process.env.DATABASE_AUTH_TOKEN,
  intMode: 'number',
});

export function reloadDb() {
  db = createClient({
    url: process.env.DATABASE_URL || `file:${DB_PATH}`,
    authToken: process.env.DATABASE_AUTH_TOKEN,
    intMode: 'number',
  });
}

// Statements run inside tx() must go to that transaction, not the pool. Keeping
// the open transaction here means the 300-odd call sites need no extra plumbing.
const txStore = new AsyncLocalStorage();
const conn = () => txStore.getStore() ?? db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'finished' CHECK (type IN ('raw','finished','trading')),
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  cost_price REAL NOT NULL DEFAULT 0,
  sale_price REAL NOT NULL DEFAULT 0,
  reorder_level REAL NOT NULL DEFAULT 0,
  labor_cost REAL NOT NULL DEFAULT 0,
  overhead_cost REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  date TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  ref_type TEXT NOT NULL,
  ref_id INTEGER,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sm_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_sm_ref ON stock_movements(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_sm_date ON stock_movements(date);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT, cnic TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT, email TEXT, address TEXT, ntn TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  date TEXT NOT NULL,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  cost_total REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit_price REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  date TEXT NOT NULL,
  vendor_bill_no TEXT,
  subtotal REAL NOT NULL DEFAULT 0,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','vendor')),
  party_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'cash',
  reference TEXT,
  sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE CASCADE,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_pay_party ON payments(party_type, party_id);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT DEFAULT 'cash',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS assemblies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  date TEXT NOT NULL,
  qty REAL NOT NULL,
  material_cost REAL NOT NULL DEFAULT 0,
  labor_cost REAL NOT NULL DEFAULT 0,
  other_cost REAL NOT NULL DEFAULT 0,
  total_cost REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS assembly_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  unit_cost REAL NOT NULL,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS day_diary_notes (
  date TEXT PRIMARY KEY,
  notes TEXT,
  closing_cash_actual REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS day_diary_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  task TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_ddt_date ON day_diary_tasks(date);

CREATE TABLE IF NOT EXISTS expense_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  group_name TEXT NOT NULL DEFAULT 'Other Expense',
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1
);

-- Money movements that belong to no customer or vendor: cash/bank transfers,
-- other income, owner capital, owner drawings and bank charges. Together with
-- payments and expenses this makes the cash and bank books complete.
CREATE TABLE IF NOT EXISTS cash_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transfer','income','capital','drawings','bank_charge')),
  from_account TEXT CHECK (from_account IN ('cash','bank')),
  to_account TEXT CHECK (to_account IN ('cash','bank')),
  amount REAL NOT NULL CHECK (amount > 0),
  category TEXT,
  reference TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK (from_account IS NOT NULL OR to_account IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_cb_date ON cash_book(date);
CREATE INDEX IF NOT EXISTS idx_cb_kind ON cash_book(kind);

-- One row per real bank account. A partnership keeps a separate account per
-- partner, so every amount that settles through a bank names the account it
-- landed in and each partner's balance can be read on its own.
CREATE TABLE IF NOT EXISTS bank_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_name TEXT,
  bank_name TEXT,
  account_number TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 100,
  active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
`;

export const defaultBankAccountId = async () =>
  (await get('SELECT id FROM bank_accounts WHERE active = 1 ORDER BY sort, id LIMIT 1'))?.id ?? null;

/** Adds a column once; SQLite has no "ADD COLUMN IF NOT EXISTS". */
async function addColumn(table, column, definition) {
  const cols = await all(`PRAGMA table_info(${table})`);
  if (!cols.some((c) => c.name === column)) {
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Brings an empty or older database up to date. Safe to run repeatedly, but it
 * costs a round trip per statement, so the serverless entry point skips it and
 * relies on `npm run migrate` having been run once.
 */
export async function migrate() {
  await db.executeMultiple(SCHEMA);

  await addColumn('payments', 'bank_account_id', 'INTEGER REFERENCES bank_accounts(id)');
  await addColumn('expenses', 'bank_account_id', 'INTEGER REFERENCES bank_accounts(id)');
  await addColumn('cash_book', 'from_bank_id', 'INTEGER REFERENCES bank_accounts(id)');
  await addColumn('cash_book', 'to_bank_id', 'INTEGER REFERENCES bank_accounts(id)');
  await addColumn('products', 'image', 'TEXT');

  // There must always be somewhere for bank money to go.
  if (!(await get('SELECT COUNT(*) AS c FROM bank_accounts')).c) {
    await run('INSERT INTO bank_accounts (name, bank_name, sort) VALUES (?,?,?)', 'Main Bank Account', null, 10);
  }

  // Money recorded before accounts existed belongs to the first account, so no
  // historical figure silently drops out of the bank book.
  const fallback = await defaultBankAccountId();
  if (fallback) {
    const notCash = `LOWER(COALESCE(method,'cash')) <> 'cash'`;
    await run(`UPDATE payments SET bank_account_id = ? WHERE bank_account_id IS NULL AND ${notCash}`, fallback);
    await run(`UPDATE expenses SET bank_account_id = ? WHERE bank_account_id IS NULL AND ${notCash}`, fallback);
    await run("UPDATE cash_book SET from_bank_id = ? WHERE from_bank_id IS NULL AND from_account = 'bank'", fallback);
    await run("UPDATE cash_book SET to_bank_id = ? WHERE to_bank_id IS NULL AND to_account = 'bank'", fallback);
  }

  if (!(await get('SELECT COUNT(*) AS c FROM expense_categories')).c) {
    for (const [name, group, sort] of DEFAULT_EXPENSE_CATEGORIES) {
      await run('INSERT INTO expense_categories (name, group_name, sort) VALUES (?,?,?)', name, group, sort);
    }
  }

  // Added after the first release: databases made before it have no tagline.
  if ((await getSetting('business_tagline')) == null) {
    await setSetting('business_tagline', 'Management System');
  }

  if ((await getSetting('business_name')) == null) {
    await setSetting('business_name', 'Aqua Home Appliance');
    await setSetting('business_tagline', 'Management System');
    await setSetting('business_address', '');
    await setSetting('business_phone', '');
    await setSetting('business_email', '');
    await setSetting('invoice_footer', 'Thank you for your business!');
    await setSetting('currency', 'Rs');
  }
}

/**
 * Payment methods. `account` decides which book an amount lands in, so the
 * cash book and bank book always add up to the same total as the ledgers.
 */
export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash', account: 'cash' },
  { value: 'bank', label: 'Bank Transfer', account: 'bank' },
  { value: 'cheque', label: 'Cheque', account: 'bank' },
  { value: 'online', label: 'Online / EasyPaisa / JazzCash', account: 'bank' },
  { value: 'card', label: 'Debit / Credit Card', account: 'bank' },
];

/** Anything that is not explicitly cash settles through the bank book. */
export const IS_CASH_SQL = `(LOWER(COALESCE(method,'cash')) = 'cash')`;
export const accountOfMethod = (m) => (String(m || 'cash').toLowerCase() === 'cash' ? 'cash' : 'bank');

/** Returns the canonical method value, or null when it is not one we know. */
export function normalizeMethod(m, fallback = 'cash') {
  const v = String(m == null || m === '' ? fallback : m).toLowerCase();
  return PAYMENT_METHODS.some((x) => x.value === v) ? v : null;
}

/**
 * Which bank account a non-cash amount settles through. Cash returns null;
 * anything else must name a real, open account so the money cannot land in an
 * unidentified bank.
 */
export async function requireBankAccountId(method, id) {
  if (accountOfMethod(method) === 'cash') return null;
  const n = Number(id) || 0;
  if (!n) throw new HttpError(400, 'Choose which bank account this money goes through');
  const row = await get('SELECT id, active FROM bank_accounts WHERE id = ?', n);
  if (!row) throw new HttpError(400, 'That bank account does not exist');
  if (!row.active) throw new HttpError(400, 'That bank account is closed');
  return n;
}

/** Max stored size of an image data URL. Keeps rows small on hosted databases. */
export const MAX_IMAGE_BYTES = 400 * 1024;

/** Validates an uploaded data URL, returning null for "no image". */
export function cleanImage(value, label = 'Image') {
  if (value == null || value === '') return null;
  const str = String(value);
  if (!/^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,/i.test(str)) {
    throw new HttpError(400, `${label} must be an uploaded image file.`);
  }
  const bytes = Math.ceil((str.length - str.indexOf(',') - 1) * 0.75);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new HttpError(400, `${label} is too large (${Math.round(bytes / 1024)} KB). Please use a smaller picture.`);
  }
  return str;
}

export const EXPENSE_GROUPS = [
  'Administrative Expense',
  'Salary of Employees',
  'Rent of Property',
  'Utility Expense',
  'Phone & Internet',
  'Traveling Expense',
  'Tax',
  'Other Expense',
];

const DEFAULT_EXPENSE_CATEGORIES = [
  ['Office & Administration', 'Administrative Expense', 10],
  ['Printing & Stationery', 'Administrative Expense', 11],
  ['Repairs & Maintenance', 'Administrative Expense', 12],
  ['Staff Salaries', 'Salary of Employees', 20],
  ['Staff Wages & Overtime', 'Salary of Employees', 21],
  ['Staff Bonus & Allowance', 'Salary of Employees', 22],
  ['Shop / Office Rent', 'Rent of Property', 30],
  ['Warehouse Rent', 'Rent of Property', 31],
  ['Electricity Bill', 'Utility Expense', 40],
  ['Gas Bill', 'Utility Expense', 41],
  ['Water Bill', 'Utility Expense', 42],
  ['Mobile Package / Load', 'Phone & Internet', 50],
  ['Landline Bill', 'Phone & Internet', 51],
  ['Internet Package', 'Phone & Internet', 52],
  ['Fuel & Petrol', 'Traveling Expense', 60],
  ['Vehicle Repair', 'Traveling Expense', 61],
  ['Travel & Fare', 'Traveling Expense', 62],
  ['Loading & Freight', 'Traveling Expense', 63],
  ['Sales Tax', 'Tax', 70],
  ['Income Tax', 'Tax', 71],
  ['Withholding Tax', 'Tax', 72],
  ['Bank Charges & Fees', 'Other Expense', 80],
  ['Marketing & Advertising', 'Other Expense', 81],
  ['Miscellaneous', 'Other Expense', 82],
];

// ---------- helpers ----------
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// libSQL rejects `undefined`; callers pass optional values freely.
const args = (params) => params.map((p) => (p === undefined ? null : p));

export async function all(sql, ...params) {
  const rs = await conn().execute({ sql, args: args(params) });
  return rs.rows.map((row) => ({ ...row }));
}
export async function get(sql, ...params) {
  const rs = await conn().execute({ sql, args: args(params) });
  return rs.rows.length ? { ...rs.rows[0] } : undefined;
}
export async function run(sql, ...params) {
  const rs = await conn().execute({ sql, args: args(params) });
  return { changes: Number(rs.rowsAffected), lastInsertRowid: rs.lastInsertRowid };
}

/** Run fn inside a transaction; rolls back on any thrown error. */
export async function tx(fn) {
  const t = await db.transaction('write');
  try {
    const out = await txStore.run(t, () => fn());
    await t.commit();
    return out;
  } catch (e) {
    try {
      await t.rollback();
    } catch {
      /* already closed */
    }
    throw e;
  }
}

export async function getSetting(key, fallback = null) {
  const row = await get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}
export async function setSetting(key, value) {
  await run(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    key,
    value == null ? null : String(value)
  );
}

// ---------- derived values ----------

/** Current stock on hand of a product. */
export async function stockOf(productId) {
  return (await get('SELECT COALESCE(SUM(qty),0) AS q FROM stock_movements WHERE product_id = ?', productId)).q;
}

/**
 * Weighted average cost from all incoming movements (purchases, assembly output,
 * opening stock, positive adjustments). Falls back to the product's cost_price.
 */
export async function avgCostOf(productId) {
  const row = await get(
    `SELECT SUM(qty*unit_cost) AS v, SUM(qty) AS q FROM stock_movements
     WHERE product_id = ? AND qty > 0 AND unit_cost > 0`,
    productId
  );
  if (row && row.q > 0) return r2(row.v / row.q);
  const p = await get('SELECT cost_price FROM products WHERE id = ?', productId);
  return p ? r2(p.cost_price) : 0;
}

// Pictures are deliberately not selected here: a few dozen of them would push
// every product list, dashboard and report past a serverless response limit.
// They are served one at a time from /products/:id/image.
export const PRODUCT_STOCK_SQL = `
  SELECT p.id, p.sku, p.name, p.type, p.category, p.unit, p.cost_price, p.sale_price,
    p.reorder_level, p.labor_cost, p.overhead_cost, p.active, p.created_at,
    (p.image IS NOT NULL AND p.image <> '') AS has_image,
    COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id = p.id),0) AS stock,
    COALESCE((SELECT SUM(qty*unit_cost)/NULLIF(SUM(qty),0) FROM stock_movements m
              WHERE m.product_id = p.id AND qty > 0 AND unit_cost > 0), p.cost_price) AS avg_cost
  FROM products p`;

export async function customerBalance(id) {
  return (await get(
    `SELECT c.opening_balance
       + COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id),0)
       - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='customer' AND party_id = c.id),0) AS bal
     FROM customers c WHERE c.id = ?`,
    id
  ))?.bal ?? 0;
}

export async function vendorBalance(id) {
  return (await get(
    `SELECT v.opening_balance
       + COALESCE((SELECT SUM(total) FROM purchases WHERE vendor_id = v.id),0)
       - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='vendor' AND party_id = v.id),0) AS bal
     FROM vendors v WHERE v.id = ?`,
    id
  ))?.bal ?? 0;
}

export const CUSTOMER_BAL_SQL = `
  SELECT c.*,
    COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id),0) AS total_sales,
    COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='customer' AND party_id = c.id),0) AS total_paid,
    c.opening_balance
      + COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id),0)
      - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='customer' AND party_id = c.id),0) AS balance
  FROM customers c`;

export const VENDOR_BAL_SQL = `
  SELECT v.*,
    COALESCE((SELECT SUM(total) FROM purchases WHERE vendor_id = v.id),0) AS total_purchases,
    COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='vendor' AND party_id = v.id),0) AS total_paid,
    v.opening_balance
      + COALESCE((SELECT SUM(total) FROM purchases WHERE vendor_id = v.id),0)
      - COALESCE((SELECT SUM(amount) FROM payments WHERE party_type='vendor' AND party_id = v.id),0) AS balance
  FROM vendors v`;

export const docNo = {
  sale: (id) => `INV-${String(id).padStart(5, '0')}`,
  purchase: (id) => `PUR-${String(id).padStart(5, '0')}`,
  assembly: (id) => `ASM-${String(id).padStart(5, '0')}`,
  payment: (id) => `PAY-${String(id).padStart(5, '0')}`,
  expense: (id) => `EXP-${String(id).padStart(5, '0')}`,
  adjustment: (id) => `ADJ-${String(id).padStart(5, '0')}`,
  cashbook: (id) => `CB-${String(id).padStart(5, '0')}`,
};
