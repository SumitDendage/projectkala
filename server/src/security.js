const crypto = require('crypto');
const db = require('./db');

/* ---------- Passwords: scrypt (memory-hard), stored as scrypt$N$r$p$salt$hash ---------- */
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const scrypt = (pw, salt, n, r, p) => new Promise((resolve, reject) =>
  crypto.scrypt(pw, salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => (err ? reject(err) : resolve(key))));

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password.normalize('NFKC'), salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

// A real hash of a random password, so a missing account takes as long to check as a real one.
let dummy = null;
async function verifyPassword(password, stored) {
  if (!stored) {
    dummy = dummy || await hashPassword(crypto.randomBytes(16).toString('hex'));
    stored = dummy;
  }
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(salt, 'base64'), +n, +r, +p);
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

/* ---------- Random tokens (cookies and email links); only SHA-256 hashes are stored ---------- */
const newToken = () => crypto.randomBytes(32).toString('base64url');
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

/* ---------- Rate limits, counted in the database so they hold across serverless instances ----------
   rules: [[kind, value, max, minutes]]. Returns true when any rule is over its limit. */
async function limited(rules) {
  const keys = rules.map(([kind, value, max, minutes]) => ({ key: sha256(`hg:${kind}:${value}`), max, minutes }));
  for (const k of keys) {
    const row = await db.one(
      `select count(*)::int as n from hg.auth_attempts where key = $1 and created_at > now() - make_interval(mins => $2)`,
      [k.key, k.minutes]);
    if (row.n >= k.max) return true;
  }
  await db.query(`insert into hg.auth_attempts (key) select unnest($1::text[])`, [keys.map(k => k.key)]);
  if (Math.random() < 0.02) db.query(`delete from hg.auth_attempts where created_at < now() - interval '2 days'`).catch(() => {});
  return false;
}

module.exports = { hashPassword, verifyPassword, newToken, sha256, limited };
