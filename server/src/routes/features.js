/* Gem Finder (the four-question match), traveller gems (shared places, shown after an admin approves
   them, with "Want to go" marks) and season reminders (one email a year when a place's best months begin). */
const express = require('express');
const config = require('../config');
const db = require('../db');
const mail = require('../mail');
const sec = require('../security');
const v = require('../visitor');
const { BY_SLUG, STATES, nextStart, monthName, inSeason } = require('../places');
const { currentMonth } = require('../reminders');
const { ah, fail, text, optText, validEmail, normEmail, UUID, siteOrigin } = require('../http');

const router = express.Router();
const uid = req => (req.user ? req.user.id : null);
const LANDSCAPES = ['mountains', 'water', 'forest', 'desert', 'heritage'];
const level = x => (Number.isInteger(x) && x >= 1 && x <= 3 ? x : null);

/* ---------- Gem Finder: record the answers and the places it suggested ---------- */
router.post('/finder', ah(async (req, res) => {
  const b = req.body || {};
  const month = Number.isInteger(b.month) && b.month >= 1 && b.month <= 12 ? b.month : null;
  const landscape = LANDSCAPES.includes(b.landscape) ? b.landscape : null;
  const results = Array.isArray(b.results) ? [...new Set(b.results.filter(s => typeof s === 'string' && BY_SLUG[s]))].slice(0, 3) : [];
  if (!results.length) return fail(res, 400, 'bad_request');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['finder-visitor', vid, 60, 60]])) return fail(res, 429, 'too_many');
  await db.query(
    `insert into hg.finder_runs (visitor_id, user_id, month, landscape, effort, budget, results) values ($1, $2, $3, $4, $5, $6, $7)`,
    [vid, uid(req), month, landscape, level(b.effort), level(b.budget), results]);
  res.status(204).end();
}));

/* ---------- Traveller gems ---------- */
const gemOut = r => ({
  id: r.id, place: r.place, state: r.state, story: r.story, bestMonths: r.best_months,
  author: r.author, votes: r.votes, voted: !!r.voted, createdAt: r.created_at
});

router.get('/gems', ah(async (req, res) => {
  const vid = v.visitorId(req, res);
  const rows = await db.many(
    `select g.id, g.place, g.state, g.story, g.best_months, g.author, g.votes, g.created_at,
       exists (select 1 from hg.gem_votes gv where gv.gem_id = g.id and gv.visitor_id = $1) as voted
     from hg.gems g where g.status = 'approved' order by g.votes desc, g.reviewed_at desc nulls last limit 24`, [vid]);
  res.json({ gems: rows.map(gemOut) });
}));

router.post('/gems', ah(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // filled in by a bot
  const firstName = req.user ? String(req.user.name).trim().split(/\s+/)[0] : '';
  const g = {
    place: text(b.place, 80), state: text(b.state, 60), story: text(b.story, 700),
    best_months: optText(b.bestMonths, 60),
    author: optText(b.author, 40) || (firstName ? firstName.slice(0, 40) : null),
    email: req.user ? req.user.email : (b.email ? normEmail(b.email) : null)
  };
  if (g.place.length < 2) return fail(res, 400, 'place_required');
  if (!STATES.includes(g.state)) return fail(res, 400, 'state_required');
  if (g.story.length < 20) return fail(res, 400, 'story_too_short');
  if (g.email && !validEmail(g.email)) return fail(res, 400, 'invalid_email');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['gem-ip', v.clientIp(req), 5, 60], ['gem-visitor', vid, 5, 60]])) return fail(res, 429, 'too_many');
  await db.query(
    `insert into hg.gems (visitor_id, user_id, place, state, story, best_months, author, email) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [vid, uid(req), g.place, g.state, g.story, g.best_months, g.author, g.email]);
  if (mail.configured() && config.adminEmails.length) {
    try { await mail.gemAlert(config.adminEmails[0], g, `${siteOrigin(req)}/admin#gems`); } catch (err) { console.error('Gem alert not sent:', err.message); }
  }
  res.status(201).json({ ok: true });
}));

async function vote(req, res, on) {
  if (!UUID.test(req.params.id)) return fail(res, 404, 'not_found');
  const gem = await db.one(`select id from hg.gems where id = $1 and status = 'approved'`, [req.params.id]);
  if (!gem) return fail(res, 404, 'not_found');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['gem-vote', vid, 120, 60]])) return fail(res, 429, 'too_many');
  if (on) await db.query(`insert into hg.gem_votes (gem_id, visitor_id) values ($1, $2) on conflict do nothing`, [gem.id, vid]);
  else await db.query(`delete from hg.gem_votes where gem_id = $1 and visitor_id = $2`, [gem.id, vid]);
  const row = await db.one(
    `update hg.gems set votes = (select count(*) from hg.gem_votes where gem_id = $1) where id = $1 returning votes`, [gem.id]);
  res.json({ votes: row.votes, voted: on });
}
router.put('/gems/:id/vote', ah((req, res) => vote(req, res, true)));
router.delete('/gems/:id/vote', ah((req, res) => vote(req, res, false)));

/* ---------- Season reminders ---------- */
router.post('/reminders', ah(async (req, res) => {
  const b = req.body || {};
  const place = BY_SLUG[text(b.slug, 60)];
  const email = normEmail(b.email);
  if (!place) return fail(res, 400, 'bad_place');
  if (!validEmail(email)) return fail(res, 400, 'invalid_email');
  if (!mail.configured()) return fail(res, 503, 'mail_not_configured');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['reminder-ip', v.clientIp(req), 10, 60], ['reminder-email', email, 5, 60 * 24]])) return fail(res, 429, 'too_many');
  const now = currentMonth().month, month = monthName(nextStart(place, now)), season = inSeason(place, now);
  // Signed in with this confirmed email: no confirmation email needed.
  const trusted = !!(req.user && req.user.email_verified_at && req.user.email === email);
  const existing = await db.one(`select id, confirmed_at, stopped_at from hg.season_alerts where email = $1 and place_slug = $2`, [email, place.slug]);
  if (existing && existing.confirmed_at && !existing.stopped_at) return res.json({ status: 'active', place: place.name, month, inSeason: season });
  const token = trusted ? null : sec.newToken();
  const row = await db.one(
    `insert into hg.season_alerts (email, place_slug, visitor_id, user_id, confirm_hash, confirm_sent_at, confirmed_at, stop_token)
     values ($1, $2, $3, $4, $5, case when $5::text is null then null else now() end, case when $6 then now() else null end, $7)
     on conflict (email, place_slug) do update set
       confirm_hash = excluded.confirm_hash, confirm_sent_at = excluded.confirm_sent_at, confirmed_at = excluded.confirmed_at,
       stopped_at = null, visitor_id = excluded.visitor_id, user_id = coalesce(excluded.user_id, hg.season_alerts.user_id)
     returning stop_token`,
    [email, place.slug, vid, uid(req), token ? sec.sha256(token) : null, trusted, sec.newToken()]);
  if (trusted) return res.json({ status: 'active', place: place.name, month, inSeason: season });
  const site = siteOrigin(req);
  try {
    await mail.alertConfirm(email, place, month, `${site}/?reminder=${token}`, `${site}/?stop-reminder=${row.stop_token}`);
  } catch (err) {
    console.error('Reminder confirmation not sent:', err.message);
    return fail(res, 502, 'mail_failed');
  }
  res.json({ status: 'confirm_sent', place: place.name, month, inSeason: season });
}));

router.post('/reminders/confirm', ah(async (req, res) => {
  const token = text((req.body || {}).token, 200);
  if (!token) return fail(res, 400, 'invalid_link');
  const row = await db.one(
    `update hg.season_alerts set confirmed_at = now(), confirm_hash = null, stopped_at = null
     where confirm_hash = $1 and confirm_sent_at > now() - interval '7 days' returning place_slug`, [sec.sha256(token)]);
  if (!row) return fail(res, 400, 'invalid_link');
  const place = BY_SLUG[row.place_slug], now = currentMonth().month;
  res.json({ place: place.name, month: monthName(nextStart(place, now)), inSeason: inSeason(place, now) });
}));

router.post('/reminders/stop', ah(async (req, res) => {
  const token = text((req.body || {}).token, 200);
  if (!token) return fail(res, 400, 'invalid_link');
  const row = await db.one(
    `update hg.season_alerts set stopped_at = coalesce(stopped_at, now()), confirm_hash = null where stop_token = $1 returning place_slug`, [token]);
  if (!row) return fail(res, 400, 'invalid_link');
  const place = BY_SLUG[row.place_slug];
  res.json({ place: place ? place.name : row.place_slug });
}));

module.exports = router;
