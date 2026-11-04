// Copies the desktop database up to Turso, so the hosted app starts with the
// real books rather than an empty set.
//
//   DATABASE_URL=... DATABASE_AUTH_TOKEN=... node src/cli-push.js [path/to/business.db]
//
// Refuses to run against a target that already holds transactions, so a second
// accidental run cannot double every sale.
import { createClient } from '@libsql/client';
import path from 'node:path';
import fs from 'node:fs';
import { migrate, all, run, tx, DATA_DIR } from './db.js';

if (!process.env.DATABASE_URL) {
  console.error('Set DATABASE_URL (and DATABASE_AUTH_TOKEN) to the Turso database you want to fill.');
  process.exit(1);
}

const localPath = path.resolve(process.argv[2] || path.join(DATA_DIR, 'business.db'));
if (!fs.existsSync(localPath)) {
  console.error(`No database found at ${localPath}`);
  process.exit(1);
}

// Order matters: parents before the rows that reference them.
const TABLES = [
  'settings', 'bank_accounts', 'expense_categories', 'products', 'customers', 'vendors',
  'sales', 'sale_items', 'purchases', 'purchase_items', 'payments', 'expenses',
  'bom_items', 'assemblies', 'assembly_items', 'stock_movements',
  'cash_book', 'day_diary_notes', 'day_diary_tasks',
];

const local = createClient({ url: `file:${localPath}`, intMode: 'number' });

console.log(`Reading   ${localPath}`);
console.log(`Writing   ${process.env.DATABASE_URL}\n`);

await migrate();

const existing = await all(
  `SELECT (SELECT COUNT(*) FROM sales) AS sales,
          (SELECT COUNT(*) FROM purchases) AS purchases,
          (SELECT COUNT(*) FROM payments) AS payments,
          (SELECT COUNT(*) FROM cash_book) AS cash_book`
);
const busy = Object.entries(existing[0]).filter(([, v]) => v > 0);
if (busy.length && process.argv[3] !== '--force') {
  console.error('The target database already has records:', busy.map(([k, v]) => `${k}=${v}`).join(', '));
  console.error('Refusing to copy on top of them. Re-run with --force only if you are sure.');
  process.exit(1);
}

let total = 0;
for (const table of TABLES) {
  let rows;
  try {
    rows = (await local.execute(`SELECT * FROM ${table}`)).rows.map((r) => ({ ...r }));
  } catch {
    console.log(`  ${table.padEnd(20)} (not in the local file, skipped)`);
    continue;
  }
  if (!rows.length) {
    console.log(`  ${table.padEnd(20)} empty`);
    continue;
  }
  const cols = Object.keys(rows[0]);
  const sql = `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
  await tx(async () => {
    for (const row of rows) await run(sql, ...cols.map((c) => (row[c] === undefined ? null : row[c])));
  });
  total += rows.length;
  console.log(`  ${table.padEnd(20)} ${rows.length} row(s)`);
}

console.log(`\nCopied ${total} rows. The hosted app now has your books.`);
process.exit(0);
