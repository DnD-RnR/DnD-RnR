import { createApp } from '../server/index.mjs';
import { openFirestoreDatabase } from '../server/firestore.mjs';

// Reuse the Firestore-backed application within a warm Vercel Function instance.
let listenerPromise;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  // The rewrite passes the original API path as a query parameter.
  const suppliedPath = req.query?.apiPath;
  const route = Array.isArray(suppliedPath) ? suppliedPath.join('/') : suppliedPath;
  if (typeof route === 'string' && route && !route.includes('?') && !route.includes('#')) {
    req.url = '/api/' + route.replace(/^\/+/, '');
  }

  // Liveness is independent from Firebase setup; it does not expose any secrets.
  if (req.method === 'GET' && new URL(req.url, 'http://localhost').pathname === '/api/health') {
    return json(res, 200, { ok: true });
  }

  try {
    if (!listenerPromise) {
      listenerPromise = openFirestoreDatabase().then((db) => {
        // Production has a canonical origin; previews use their assigned Vercel host.
        const origin = process.env.VERCEL_ENV === 'production'
          ? (process.env.APP_ORIGIN || 'https://dnd-rnr.vercel.app')
          : 'https://' + (req.headers.host || process.env.VERCEL_URL);
        return createApp(db, origin).listeners('request')[0];
      }).catch((error) => {
        listenerPromise = undefined;
        throw error;
      });
    }
    const listener = await listenerPromise;
    return await listener(req, res);
  } catch (error) {
    console.error('DnD-RnR API unavailable:', error);
    if (!res.headersSent) return json(res, 503, { error: 'API jest chwilowo niedostępne.' });
  }
}
