/* Accounts: sign up, sign in, sign out, forgot and reset password, email confirmation. */
const crypto = require('crypto');
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
const MAX_CODE_TRIES = 5;
const newCode = () => String(crypto.randomInt(0, 1000000)).padStart(6, '0');
const codeHash = (userId, code) => sec.sha256(`${userId}:${code}`);
const cleanCode = v => String(v || '').replace(/\D/g, '');

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

// Email a one-time link (?reset=… or ?verify=…) and a 6-digit code (OTP) that does the same job.
// Older unused links and codes of the same kind stop working.
async function sendLink(req, user, purpose) {
  const token = sec.newToken(), code = newCode();
  await db.query(
    `with old as (update hg.tokens set used_at = now() where user_id = $2 and purpose = $3 and used_at is null)
     insert into hg.tokens (token_hash, user_id, purpose, expires_at, code_hash) values ($1, $2, $3, now() + make_interval(hours => $4), $5)`,
    [sec.sha256(token), user.id, purpose, LINK_HOURS[purpose], codeHash(user.id, code)]);
  const link = `${siteOrigin(req)}/?${purpose}=${token}`;
  if (purpose === 'reset') await mail.resetEmail(user.email, user.name, link, code);
  else await mail.verifyEmail(user.email, user.name, link, code);
}

// Check a typed code against the user's latest unused one. Wrong tries are counted; after
// MAX_CODE_TRIES the code is used up. Returns the token row, or an error name.
async function useCode(c, userId, purpose, code) {
  const t = (await c.query(
    `select token_hash, code_hash, attempts from hg.tokens
     where user_id = $1 and purpose = $2 and used_at is null and expires_at > now() and code_hash is not null
     order by created_at desc limit 1 for update`, [userId, purpose])).rows[0];
  if (!t || t.attempts >= MAX_CODE_TRIES) return { error: 'code_expired' };
  if (code.length !== 6 || t.code_hash !== codeHash(userId, code)) {
    const left = MAX_CODE_TRIES - t.attempts - 1;
    await c.query(`update hg.tokens set attempts = attempts + 1, used_at = case when $2 then now() else used_at end where token_hash = $1`,
      [t.token_hash, left <= 0]);
    return { error: left <= 0 ? 'code_expired' : 'invalid_code', left };
  }
  await c.query(`update hg.tokens set used_at = now() where token_hash = $1`, [t.token_hash]);
  return { ok: true };
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
  const token = text(b.token, 200), pw = password(b), code = cleanCode(b.code), email = normEmail(b.email);
  if (!token && !(code && validEmail(email))) return fail(res, 400, 'invalid_token');
  if (!strongEnough(pw)) return fail(res, 400, 'weak_password');
  if (await sec.limited([['reset-ip', v.clientIp(req), 30, 60]])) return fail(res, 429, 'too_many');
  const hash = await sec.hashPassword(pw);
  let codeError = null;
  const user = await db.transaction(async c => {
    let t;
    if (token) {
      t = (await c.query(
        `update hg.tokens set used_at = now()
         where token_hash = $1 and purpose = 'reset' and used_at is null and expires_at > now() returning user_id`,
        [sec.sha256(token)])).rows[0];
    } else {
      // Typed code: same answer for an unknown email as for an expired code.
      const u = (await c.query(`select id from hg.users where email = $1`, [email])).rows[0];
      const r = u ? await useCode(c, u.id, 'reset', code) : { error: 'code_expired' };
      if (r.error) { codeError = r; return null; }
      t = { user_id: u.id };
    }
    if (!t) return null;
    // Opening the emailed link also proves the address, so it counts as confirmed.
    const u = (await c.query(
      `update hg.users set password_hash = $2, password_changed_at = now(), last_login_at = now(),
         email_verified_at = coalesce(email_verified_at, now())
       where id = $1 returning *`, [t.user_id, hash])).rows[0];
    await c.query(`delete from hg.sessions where user_id = $1`, [u.id]);
    return u;
  });
  if (codeError) return fail(res, 400, codeError.error, codeError.left > 0 ? { attemptsLeft: codeError.left } : {});
  if (!user) return fail(res, 400, 'invalid_token');
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

// The 6-digit code from the confirmation email, typed in by the signed-in visitor.
router.post('/auth/verify-code', ah(async (req, res) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  if (req.user.email_verified_at) return res.json({ verified: true, user: publicUser(req.user) });
  const code = cleanCode((req.body || {}).code);
  if (await sec.limited([['verify-code-ip', v.clientIp(req), 30, 60]])) return fail(res, 429, 'too_many');
  const r = await db.transaction(c => useCode(c, req.user.id, 'verify', code));
  if (r.error) return fail(res, 400, r.error, r.left > 0 ? { attemptsLeft: r.left } : {});
  const u = await db.one(`update hg.users set email_verified_at = coalesce(email_verified_at, now()) where id = $1 returning *`, [req.user.id]);
  res.json({ verified: true, user: publicUser(u) });
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
