// Local / desktop entry point: bring the schema up to date, then listen.
// The serverless entry point (netlify/functions/api.js) imports app.js directly
// and skips the migration, which has already been applied by `npm run migrate`.
import app from './app.js';
import { migrate, DB_PATH, IS_REMOTE } from './db.js';
import { ensureOwner } from './auth.js';

const PORT = Number(process.env.PORT) || 5174;

await migrate();
await ensureOwner();

app.listen(PORT, () => {
  console.log(`\n  Business Management API running on http://localhost:${PORT}`);
  console.log(`  Database: ${IS_REMOTE ? process.env.DATABASE_URL : DB_PATH}\n`);
});
