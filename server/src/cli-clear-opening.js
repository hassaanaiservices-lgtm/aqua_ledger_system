// Deletes every opening-stock entry and nothing else: sales, purchases,
// assemblies and manual adjustments are untouched. Stock that was sold out of
// the opening stock goes negative until real stock is entered.
//
//   DATABASE_URL=... DATABASE_AUTH_TOKEN=... node src/cli-clear-opening.js          (preview only)
//   DATABASE_URL=... DATABASE_AUTH_TOKEN=... node src/cli-clear-opening.js --yes    (backup, then delete)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { all, run, DB_PATH } from './db.js';
import { buildArchive } from './archive.js';

console.log(`Database: ${process.env.DATABASE_URL || DB_PATH}\n`);

const rows = await all(
  `SELECT p.name,
     SUM(CASE WHEN m.ref_type = 'opening' THEN m.qty ELSE 0 END) AS opening,
     SUM(m.qty) AS now
   FROM stock_movements m JOIN products p ON p.id = m.product_id
   GROUP BY p.id HAVING SUM(CASE WHEN m.ref_type = 'opening' THEN 1 ELSE 0 END) > 0
   ORDER BY p.name`
);
if (!rows.length) {
  console.log('There are no opening stock entries. Nothing to do.');
  process.exit(0);
}
for (const r of rows) {
  console.log(`${r.name.slice(0, 50).padEnd(50)} opening ${String(r.opening).padStart(4)}   stock now ${String(r.now).padStart(4)}   after ${String(r.now - r.opening).padStart(4)}`);
}

if (!process.argv.includes('--yes')) {
  console.log('\nPreview only. Run again with --yes to delete these opening stock entries.');
  process.exit(0);
}

const backup = path.join(os.homedir(), `aqua-backup-before-opening-removal-${new Date().toISOString().slice(0, 10)}.json`);
fs.writeFileSync(backup, JSON.stringify(await buildArchive(), null, 2));
console.log(`\nFull backup saved: ${backup}`);

const res = await run(`DELETE FROM stock_movements WHERE ref_type = 'opening'`);
console.log(`Deleted ${res.changes} opening stock entries. Everything else is unchanged.`);
process.exit(0);
