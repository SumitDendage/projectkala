const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

/* ---------- Cookies ---------- */
const SESSION_COOKIE = 'hg_session';
const VISITOR_COOKIE = 'hg_vid';
const COOKIE_PATH = '/api/v1';

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 1) return;
    const name = part.slice(0, i).trim();
    try { out[name] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { /* ignore a bad cookie */ }
  });
  return out;
}

function setCookie(res, name, value, maxAgeSeconds) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${COOKIE_PATH}`, `Max-Age=${maxAgeSeconds}`, 'HttpOnly', 'SameSite=Lax'];
  if (config.secureCookies) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}
const clearCookie = (res, name) => setCookie(res, name, '', 0);

/* ---------- Who is calling: device, browser and rough location (no exact location, no raw IP stored) ---------- */
function parseUserAgent(ua) {
  const s = String(ua || '');
  let device = /iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/i.test(s) ? 'Tablet' : /Mobi|iPhone|iPod|Android/i.test(s) ? 'Phone' : 'Desktop';
  if (/bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python|node-fetch/i.test(s)) device = 'Bot';
  const browser =
    /Edg(e|A|iOS)?\//.test(s) ? 'Edge' :
    /OPR\/|Opera/.test(s) ? 'Opera' :
    /SamsungBrowser\//.test(s) ? 'Samsung Internet' :
    /FxiOS\/|Firefox\//.test(s) ? 'Firefox' :
    /CriOS\/|Chrome\/|Chromium\//.test(s) ? 'Chrome' :
    /Safari\//.test(s) && /Version\//.test(s) ? 'Safari' : 'Other';
  const os =
    /Windows NT/.test(s) ? 'Windows' :
    /iPhone|iPad|iPod/.test(s) ? 'iOS' :
    /CrOS/.test(s) ? 'ChromeOS' :
    /Android/.test(s) ? 'Android' :
    /Mac OS X|Macintosh/.test(s) ? 'macOS' :
    /Linux/.test(s) ? 'Linux' : 'Other';
  return { device, browser, os };
}

// Netlify adds the visitor's approximate location as a base64 JSON header.
function geoFrom(req) {
  const out = { country: null, region: null, city: null };
  const raw = req.get('x-nf-geo');
  if (raw) {
    try {
      const g = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      out.country = (g.country && (g.country.name || g.country.code)) || null;
      out.region = (g.subdivision && (g.subdivision.name || g.subdivision.code)) || null;
      out.city = g.city || null;
    } catch (e) { /* no location */ }
  }
  if (!out.country && req.get('x-country')) out.country = req.get('x-country');
  for (const k of Object.keys(out)) out[k] = out[k] ? String(out[k]).slice(0, 80) : null;
  return out;
}

const clientIp = req => req.get('x-nf-client-connection-ip') || req.ip || 'unknown';

/* ---------- The anonymous visitor id (one per browser, kept in an HttpOnly cookie) ---------- */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function visitorId(req, res) {
  if (req.visitorId) return req.visitorId;
  let id = req.cookies[VISITOR_COOKIE];
  if (!id || !UUID.test(id)) {
    id = crypto.randomUUID();
    req.newVisitor = true;
  }
  setCookie(res, VISITOR_COOKIE, id, 60 * 60 * 24 * 365);
  req.visitorId = id;
  return id;
}

// Makes sure the visitor row exists (for chats, place events and enquiries that point to it).
async function ensureVisitor(req, res) {
  const id = visitorId(req, res);
  if (!req.visitorSaved) {
    const ua = parseUserAgent(req.get('user-agent')), geo = geoFrom(req);
    await db.query(
      `insert into hg.visitors (id, user_id, country, region, city, device, browser, os)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (id) do nothing`,
      [id, req.user ? req.user.id : null, geo.country, geo.region, geo.city, ua.device, ua.browser, ua.os]);
    req.visitorSaved = true;
  }
  return id;
}

module.exports = {
  SESSION_COOKIE, VISITOR_COOKIE, parseCookies, setCookie, clearCookie,
  parseUserAgent, geoFrom, clientIp, visitorId, ensureVisitor
};
