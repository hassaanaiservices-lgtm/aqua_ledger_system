// Complete, portable archive of the books.
//
// The .db download is an exact SQLite file but only the desktop build can read
// one back. The JSON archive here works everywhere, including a hosted Turso
// database, so it is the format that actually moves a business online.
import { db, all, getSetting, migrate } from './db.js';

export const ARCHIVE_FORMAT = 'aqua-archive-v1';

// Parents first; restoring deletes in reverse so nothing is orphaned.
export const ARCHIVE_TABLES = [
  'settings',
  'bank_accounts',
  'expense_categories',
  'products',
  'customers',
  'vendors',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'payments',
  'expenses',
  'bom_items',
  'assemblies',
  'assembly_items',
  'stock_movements',
  'cash_book',
  'day_diary_notes',
  'day_diary_tasks',
];

// Credentials never travel in a backup file: a downloaded archive would
// otherwise carry the owner's password hash, and restoring it would silently
// change the password and sign everyone out.
const SECRET_SETTINGS = new Set(['password_hash', 'auth_secret']);

/**
 * Raw rows for every table, exactly as they must be inserted again. Derived
 * figures (stock, balances) are deliberately left out — they are recomputed
 * from these rows, so storing them would only create a second version of the
 * truth that could disagree.
 */
export async function buildArchive() {
  const tables = {};
  const counts = {};
  for (const table of ARCHIVE_TABLES) {
    let rows = await all(`SELECT * FROM ${table}`);
    if (table === 'settings') rows = rows.filter((r) => !SECRET_SETTINGS.has(r.key));
    tables[table] = rows;
    counts[table] = rows.length;
  }
  return {
    app: 'Aqua Home Appliance Business Manager',
    format: ARCHIVE_FORMAT,
    exported_at: new Date().toISOString(),
    business_name: await getSetting('business_name', 'Aqua Home Appliance'),
    note: 'Stock levels and ledger balances are not stored here. They are recalculated from these records, so they can never drift out of step.',
    counts,
    tables,
  };
}

export class ArchiveError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** Replaces everything in the database with the contents of `archive`. */
export async function importArchive(archive) {
  if (!archive || typeof archive !== 'object' || !archive.tables) {
    throw new ArchiveError('That file is not an Aqua Home Appliance archive.');
  }
  if (archive.format && archive.format !== ARCHIVE_FORMAT) {
    throw new ArchiveError(`Unsupported archive format "${archive.format}".`);
  }
  const known = ARCHIVE_TABLES.filter((t) => Array.isArray(archive.tables[t]));
  if (!known.length) throw new ArchiveError('The archive contains no recognisable records.');

  // Older exports carry derived figures (stock, balances) that are not columns
  // at all; keep only what the table can actually hold.
  const columns = {};
  await Promise.all(
    known.map(async (t) => {
      columns[t] = new Set((await all(`PRAGMA table_info(${t})`)).map((c) => c.name));
    })
  );

  // One batch is one round trip and one transaction: row-by-row inserts to a
  // hosted database take longer than a serverless function is allowed to run.
  const statements = [];
  const imported = {};
  for (const table of [...ARCHIVE_TABLES].reverse()) {
    statements.push(
      table === 'settings'
        ? `DELETE FROM settings WHERE key NOT IN ('password_hash','auth_secret')`
        : `DELETE FROM ${table}`
    );
  }
  for (const table of known) {
    let n = 0;
    for (const row of archive.tables[table]) {
      if (table === 'settings' && SECRET_SETTINGS.has(row.key)) continue;
      const cols = Object.keys(row).filter((c) => columns[table].has(c));
      if (!cols.length) continue;
      statements.push({
        sql: `INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args: cols.map((c) => (row[c] === undefined ? null : row[c])),
      });
      n += 1;
    }
    imported[table] = n;
  }
  await db.batch(statements, 'write');
  // Files from before bank accounts and expense categories existed lack them.
  await migrate();
  return imported;
}
