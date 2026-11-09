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

  // Health: the site uses this to decide which features to show. Add ?check=db to also try the
  // database (handy right after setting up a new host): it says whether it answered, or why not.
  api.get('/health', ah(async (req, res) => {
    const out = { ok: true, database: db.configured(), mail: mail.configured() };
    if (req.query.check === 'db' && db.configured()) {
      try {
        await Promise.race([db.query('select 1 from hg.users limit 1'), new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), 8000))]);
        out.databaseReachable = true;
      } catch (e) {
        const m = String(e.message || '');
        out.databaseReachable = false;
        out.databaseProblem = e.code === 'timeout' || /ETIMEDOUT|timeout/i.test(m) ? 'no answer (check the host and port; some hosts block outgoing port 6543, then try port 5432)'
          : e.code === '28P01' || /password authentication/i.test(m) ? 'wrong user or password in DATABASE_URL'
          : /tenant or user not found/i.test(m) ? 'wrong pooler address: copy it from Supabase → Connect'
          : e.code === 'ENOTFOUND' ? 'the database host name in DATABASE_URL does not exist'
          : e.code === 'ECONNREFUSED' ? 'connection refused by the database host'
          : e.code === '42P01' ? 'connected, but the tables are missing: run server/schema.sql'
          : 'could not connect (' + (e.code || 'unknown') + ')';
      }
    }
    res.json(out);
  }));

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
