// Applies the schema to whichever database DATABASE_URL points at (or the local
// file when it is unset). Run once before the first deploy, and again after any
// release that adds tables or columns.
import { migrate, DB_PATH } from './db.js';

console.log(`Applying schema to: ${process.env.DATABASE_URL || DB_PATH}`);
await migrate();
console.log('Schema is up to date.');
process.exit(0);
