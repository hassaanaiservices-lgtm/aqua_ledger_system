// Loads a JSON archive straight into the database DATABASE_URL points at,
// skipping the browser and the serverless time limit. Replaces all data.
//
//   DATABASE_URL=... DATABASE_AUTH_TOKEN=... node src/cli-import.js file.json
import fs from 'node:fs';
import { migrate } from './db.js';
import { importArchive } from './archive.js';

const file = process.argv[2];
if (!process.env.DATABASE_URL || !file) {
  console.error('Usage: DATABASE_URL=... DATABASE_AUTH_TOKEN=... node src/cli-import.js archive.json');
  process.exit(1);
}
await migrate();
console.log(await importArchive(JSON.parse(fs.readFileSync(file, 'utf8'))));
console.log('Done.');
process.exit(0);
