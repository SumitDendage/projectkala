/* Accounts: sign up, sign in, sign out, forgot and reset password, email confirmation. */
const express = require('express');
const db = require('../db');
const mail = require('../mail');
const sec = require('../security');
const v = require('../visitor');
const { ah, fail, text, validEmail, normEmail, publicUser, siteOrigin } = require('../http');

const router = express.Router();
const SESSION_DAYS = 30;
const LINK_HOURS = { reset: 1, verify: 48 };
const password = b => (typeof b.password === 'string' ? b.password : '');
const strongEnough = pw => pw.length >= 8 && pw.length <= 128;

// Everything this browser did before signing in (chats, place views, enquiries) joins the account.
async function linkVisitor(req, res, userId) {
  const vid = v.visitorId(req, res);
  const ua = v.parseUserAgent(req.get('user-agent')), geo = v.geoFrom(req);
  await db.query(
    `with vis as (
       insert into hg.visitors (id, user_id, country, region, city, device, browser, os)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (id) do update set user_id = excluded.user_id returning id),
     c as (update hg.chats set user_id = $2 where visitor_id = $1 and user_id is null),
     p as (update hg.place_events set user_id = $2 where visitor_id = $1 and user_id is null),
     e as (update hg.enquiries set user_id = $2 where visitor_id = $1 and user_id is null)
     select 1`,
    [vid, userId, geo.country, geo.region, geo.city, ua.device, ua.browser, ua.os]);
  req.visitorSaved = true;
}

async function startSession(req, res, user) {
  const token = sec.newToken();
  await db.query(
    `insert into hg.sessions (token_hash, user_id, expires_at, user_agent)
     values ($1, $2, now() + make_interval(days => $3), $4)`,
    [sec.sha256(token), user.id, SESSION_DAYS, text(req.get('user-agent'), 300) || null]);
  v.setCookie(res, v.SESSION_COOKIE, token, SESSION_DAYS * 86400);
  req.user = user;
  await linkVisitor(req, res, user.id);
}

// Email a one-time link (?reset=… or ?verify=…). Older unused links of the same kind stop working.
async function sendLink(req, user, purpose) {
  const token = sec.newToken();
  await db.query(
    `with old as (update hg.tokens set used_at = now() where user_id = $2 and purpose = $3 and used_at is null)
     insert into hg.tokens (token_hash, user_id, purpose, expires_at) values ($1, $2, $3, now() + make_interval(hours => $4))`,
    [sec.sha256(token), user.id, purpose, LINK_HOURS[purpose]]);
  const link = `${siteOrigin(req)}/?${purpose}=${token}`;
  if (purpose === 'reset') await mail.resetEmail(user.email, user.name, link);
  else await mail.verifyEmail(user.email, user.name, link);
}

router.get('/auth/me', (req, res) => res.json({ user: publicUser(req.user), mail: mail.configured() }));

router.post('/auth/signup', ah(async (req, res) => {
  const b = req.body || {};
  const name = text(b.name, 100), email = normEmail(b.email), pw = password(b);
  if (!name) return fail(res, 400, 'name_required');
  if (!validEmail(email)) return fail(res, 400, 'invalid_email');
  if (!strongEnough(pw)) return fail(res, 400, 'weak_password');
  if (await sec.limited([['signup-ip', v.clientIp(req), 20, 60]])) return fail(res, 429, 'too_many');
  const hash = await sec.hashPassword(pw);
  let user;
  try {
    user = await db.one(
      `insert into hg.users (name, email, password_hash, last_login_at) values ($1, $2, $3, now()) returning *`,
      [name, email, hash]);
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'email_in_use');
    throw e;
  }
  await startSession(req, res, user);
  let verificationSent = false;
  if (mail.configured()) {
    try { await sendLink(req, user, 'verify'); verificationSent = true; } catch (e) { console.error('Confirmation email not sent:', e.message); }
  }
  res.status(201).json({ user: publicUser(user), verificationSent });
}));

router.post('/auth/signin', ah(async (req, res) => {
  const b = req.body || {};
  const email = normEmail(b.email), pw = password(b);
  if (!validEmail(email) || !pw) return fail(res, 400, 'missing_fields');
  if (await sec.limited([['signin-ip', v.clientIp(req), 30, 15], ['signin-email', email, 10, 15]])) return fail(res, 429, 'too_many');
  const user = await db.one(`select * from hg.users where email = $1`, [email]);
  const ok = await sec.verifyPassword(pw, user && user.password_hash);
  if (!user || !ok) return fail(res, 401, 'invalid_credentials');
  await db.query(`update hg.users set last_login_at = now() where id = $1`, [user.id]);
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/signout', ah(async (req, res) => {
  if (req.sessionToken) await db.query(`delete from hg.sessions where token_hash = $1`, [sec.sha256(req.sessionToken)]);
  v.clearCookie(res, v.SESSION_COOKIE);
  res.json({ ok: true });
}));

// Always the same answer, so nobody can use this to find out who has an account.
router.post('/auth/forgot', ah(async (req, res) => {
  const email = normEmail((req.body || {}).email);
  if (!validEmail(email)) return fail(res, 400, 'invalid_email');
  if (!mail.configured()) return fail(res, 503, 'mail_not_configured');
  if (await sec.limited([['forgot-ip', v.clientIp(req), 20, 60], ['forgot-email', email, 5, 60]])) return fail(res, 429, 'too_many');
  const user = await db.one(`select * from hg.users where email = $1`, [email]);
  if (user) {
    try { await sendLink(req, user, 'reset'); } catch (e) { console.error('Reset email not sent:', e.message); }
  }
  res.json({ ok: true });
}));

// From the emailed link: choose a new password. Signs out every other device, then signs in here.
router.post('/auth/reset', ah(async (req, res) => {
  const b = req.body || {};
  const token = text(b.token, 200), pw = password(b);
  if (!token) return fail(res, 400, 'invalid_token');
  if (!strongEnough(pw)) return fail(res, 400, 'weak_password');
  if (await sec.limited([['reset-ip', v.clientIp(req), 30, 60]])) return fail(res, 429, 'too_many');
  const hash = await sec.hashPassword(pw);
  const user = await db.transaction(async c => {
    const t = (await c.query(
      `update hg.tokens set used_at = now()
       where token_hash = $1 and purpose = 'reset' and used_at is null and expires_at > now() returning user_id`,
      [sec.sha256(token)])).rows[0];
    if (!t) return null;
    // Opening the emailed link also proves the address, so it counts as confirmed.
    const u = (await c.query(
      `update hg.users set password_hash = $2, password_changed_at = now(), last_login_at = now(),
         email_verified_at = coalesce(email_verified_at, now())
       where id = $1 returning *`, [t.user_id, hash])).rows[0];
    await c.query(`delete from hg.sessions where user_id = $1`, [u.id]);
    return u;
  });
  if (!user) return fail(res, 400, 'invalid_token');
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

router.post('/auth/verify', ah(async (req, res) => {
  const token = text((req.body || {}).token, 200);
  if (!token) return fail(res, 400, 'invalid_token');
  const t = await db.one(
    `update hg.tokens set used_at = now()
     where token_hash = $1 and purpose = 'verify' and used_at is null and expires_at > now() returning user_id`,
    [sec.sha256(token)]);
  if (!t) return fail(res, 400, 'invalid_token');
  const u = await db.one(`update hg.users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning *`, [t.user_id]);
  const signedInAsThem = req.user && req.user.id === u.id;
  res.json({ verified: true, user: publicUser(signedInAsThem ? u : req.user) });
}));

router.post('/auth/resend-verification', ah(async (req, res) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  if (req.user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });
  if (!mail.configured()) return fail(res, 503, 'mail_not_configured');
  if (await sec.limited([['verify-user', req.user.id, 5, 60]])) return fail(res, 429, 'too_many');
  await sendLink(req, req.user, 'verify');
  res.json({ ok: true });
}));

module.exports = router;
