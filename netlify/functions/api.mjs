// Netlify entry point: the same Express app the desktop build runs, wrapped as
// a serverless function. The schema is applied by `npm run migrate`, not here,
// because re-checking it on every cold start would cost a round trip per table.
import serverless from 'serverless-http';
import app from '../../server/src/app.js';

const FN_PREFIX = '/.netlify/functions/api';
const inner = serverless(app);

/**
 * netlify.toml rewrites `/api/x` to `/.netlify/functions/api/api/x`, so the
 * function prefix is stripped back off here and Express sees the `/api/x` it
 * actually declares its routes under.
 */
export const handler = async (event, context) => {
  if (typeof event.path === 'string' && event.path.startsWith(FN_PREFIX)) {
    event.path = event.path.slice(FN_PREFIX.length) || '/';
  }
  if (typeof event.rawUrl === 'string') {
    event.rawUrl = event.rawUrl.replace(FN_PREFIX, '') || '/';
  }
  return inner(event, context);
};
