// Netlify entry point: the same Express app the desktop build runs, wrapped as
// a serverless function.
//
// The schema and the owner account are prepared once per cold start, on the
// first request, rather than at import time. Top-level await would stop Netlify
// from bundling this file, and the migration on every instance is cheap because
// it only reads and creates missing pieces.
import serverless from 'serverless-http';
import app from '../../server/src/app.js';
import { migrate } from '../../server/src/db.js';
import { ensureOwner } from '../../server/src/auth.js';

const FN_PREFIX = '/.netlify/functions/api';
const inner = serverless(app);

let ready = null;
const prepare = () => (ready ??= migrate().then(ensureOwner).catch((e) => {
  ready = null;
  throw e;
}));

export const handler = async (event, context) => {
  await prepare();
  if (typeof event.path === 'string' && event.path.startsWith(FN_PREFIX)) {
    event.path = event.path.slice(FN_PREFIX.length) || '/';
  }
  if (typeof event.rawUrl === 'string') {
    event.rawUrl = event.rawUrl.replace(FN_PREFIX, '') || '/';
  }
  return inner(event, context);
};
