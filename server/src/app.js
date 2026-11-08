/* India's Hidden Gems backend (Node.js + Express).
   Mounted at /api/v1 on the site. Runs locally (src/local.js) and on Netlify Functions (netlify/api.js). */
const express = require('express');
const config = require('./config');
const db = require('./db');
const mail = require('./mail');
const { sha256 } = require('./security');
const { parseCookies, SESSION_COOKIE } = require('./visitor');
const { ah, fail } = require('./http');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  const api = express.Router();

  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    req.cookies = parseCookies(req.headers.cookie);
    next();
  });

  // Requests that change something must come from the site itself (cookies are SameSite=Lax too).
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin) return next(); // not a browser request; browsers always send Origin here
    let host;
    try { host = new URL(origin).host.toLowerCase(); } catch (e) { return fail(res, 403, 'bad_origin'); }
    const own = [req.get('x-forwarded-host'), req.get('host')].filter(Boolean).map(h => h.split(',')[0].trim().toLowerCase());
    if (config.siteUrl) { try { own.push(new URL(config.siteUrl).host.toLowerCase()); } catch (e) { /* ignore */ } }
    const allowed = own.includes(host) || config.allowedOrigins.includes(origin.toLowerCase());
    return allowed ? next() : fail(res, 403, 'bad_origin');
  });

  api.use(express.json({ limit: '64kb' }));

  // Health: the site uses this to decide which features to show.
  api.get('/health', (req, res) => res.json({ ok: true, database: db.configured(), mail: mail.configured() }));

  api.use((req, res, next) => (db.configured() ? next() : fail(res, 503, 'not_configured')));

  // Who is signed in (from the session cookie).
  api.use(ah(async (req, res, next) => {
    req.user = null;
    const token = req.cookies[SESSION_COOKIE];
    if (token && token.length < 200) {
      req.user = await db.one(
        `select u.* from hg.sessions s join hg.users u on u.id = s.user_id
         where s.token_hash = $1 and s.expires_at > now()`, [sha256(token)]);
      req.sessionToken = req.user ? token : null;
    }
    next();
  }));

  api.use(require('./routes/auth'));
  api.use(require('./routes/visitors'));
  api.use('/admin', require('./routes/admin'));

  api.use((req, res) => fail(res, 404, 'not_found'));
  // eslint-disable-next-line no-unused-vars
  api.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return fail(res, 400, 'bad_request');
    console.error('API error:', err.message);
    return fail(res, 500, 'server_error');
  });

  // On Netlify the function may see either the public path or its own path.
  app.use('/api/v1', api);
  app.use('/.netlify/functions/api', api);
  return app;
}

module.exports = { createApp };
