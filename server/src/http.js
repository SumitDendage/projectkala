const config = require('./config');

// Wrap async route handlers so errors reach the error handler.
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fail = (res, status, error, extra = {}) => res.status(status).json({ error, ...extra });

/* ---------- Input checks ---------- */
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const optText = (v, max) => { const t = text(v, max); return t || null; };
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const validEmail = v => typeof v === 'string' && v.length <= 200 && EMAIL.test(v.trim());
const normEmail = v => String(v || '').trim().toLowerCase();
const SLUG = /^[a-z0-9-]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- Accounts as the site sees them ---------- */
const isAdmin = u => !!(u && u.email_verified_at && config.adminEmails.includes(u.email));
const publicUser = u => (u ? {
  id: u.id, name: u.name, email: u.email,
  emailVerified: !!u.email_verified_at, isAdmin: isAdmin(u), createdAt: u.created_at
} : null);

// The site's own address, for links in emails.
function siteOrigin(req) {
  if (config.siteUrl) return config.siteUrl;
  const proto = (req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

// Page and page size for admin lists.
function paging(req, size = 50) {
  const page = Math.max(1, Math.min(10000, parseInt(req.query.page, 10) || 1));
  return { page, limit: size, offset: (page - 1) * size };
}

module.exports = { ah, fail, text, optText, validEmail, normEmail, SLUG, UUID, isAdmin, publicUser, siteOrigin, paging };
