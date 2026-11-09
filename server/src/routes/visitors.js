/* Visitors: visits, places viewed and saved, questions asked to the AI consultant, trip enquiries. */
const express = require('express');
const config = require('../config');
const db = require('../db');
const mail = require('../mail');
const sec = require('../security');
const v = require('../visitor');
const { ah, fail, text, optText, validEmail, normEmail, SLUG, UUID, publicUser, siteOrigin } = require('../http');

const router = express.Router();
const uid = req => (req.user ? req.user.id : null);

// Keep only where a visitor came from (site and path), never query strings; skip our own pages.
function cleanReferrer(ref, req) {
  try {
    const u = new URL(String(ref));
    if (!/^https?:$/.test(u.protocol)) return null;
    const own = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
    if (u.host.toLowerCase() === own) return null;
    return (u.host + u.pathname).slice(0, 200);
  } catch (e) {
    return null;
  }
}

/* ---------- One call per page load: records the visit and says who is signed in ----------
   Loads within 30 minutes of the last one count as the same visit. */
router.post('/visit', ah(async (req, res) => {
  const b = req.body || {};
  const vid = v.visitorId(req, res);
  const ua = v.parseUserAgent(req.get('user-agent')), geo = v.geoFrom(req, b.timezone);
  const row = await db.one(
    `with prev as (select max(created_at) as last from hg.visits where visitor_id = $1),
     fresh as (select (select last from prev) is null or (select last from prev) < now() - interval '30 minutes' as yes),
     vis as (
       insert into hg.visitors (id, user_id, country, region, city, device, browser, os, visit_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1)
       on conflict (id) do update set
         last_seen = now(),
         user_id = coalesce(excluded.user_id, hg.visitors.user_id),
         country = coalesce(excluded.country, hg.visitors.country),
         region = coalesce(excluded.region, hg.visitors.region),
         city = coalesce(excluded.city, hg.visitors.city),
         device = excluded.device, browser = excluded.browser, os = excluded.os,
         visit_count = hg.visitors.visit_count + (case when (select yes from fresh) then 1 else 0 end)
       returning id),
     ins as (
       insert into hg.visits (visitor_id, user_id, path, referrer, country, region, city, device, browser, os, language, timezone)
       select $1, $2, $9, $10, $3, $4, $5, $6, $7, $8, $11, $12 where (select yes from fresh) and exists (select 1 from vis)
       returning id)
     select (select count(*) from ins)::int as new_visit`,
    [vid, uid(req), geo.country, geo.region, geo.city, ua.device, ua.browser, ua.os,
      text(b.path, 300) || '/', cleanReferrer(b.referrer, req), optText(b.language, 35), optText(b.timezone, 60)]);
  req.visitorSaved = true;
  res.json({ user: publicUser(req.user), mail: mail.configured(), newVisit: row.new_visit === 1 });
}));

/* ---------- Places in the 3D ring ---------- */
router.post('/track/place', ah(async (req, res) => {
  const slug = text((req.body || {}).slug, 60);
  if (!SLUG.test(slug)) return fail(res, 400, 'bad_place');
  const vid = await v.ensureVisitor(req, res);
  // One view per place per visitor every 30 minutes, however long they spin the ring.
  await db.query(
    `insert into hg.place_events (visitor_id, user_id, place_slug, action)
     select $1, $2, $3, 'view' where not exists (
       select 1 from hg.place_events where visitor_id = $1 and place_slug = $3 and action = 'view' and created_at > now() - interval '30 minutes')`,
    [vid, uid(req), slug]);
  res.status(204).end();
}));

const savedList = async userId =>
  (await db.many(`select place_slug from hg.saved_places where user_id = $1 order by created_at`, [userId])).map(r => r.place_slug);

router.get('/me/saved', ah(async (req, res) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  res.json({ places: await savedList(req.user.id) });
}));

router.put('/me/saved/:slug', ah(async (req, res) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return fail(res, 400, 'bad_place');
  const vid = await v.ensureVisitor(req, res);
  const count = await db.one(`select count(*)::int as n from hg.saved_places where user_id = $1`, [req.user.id]);
  if (count.n >= 50) return fail(res, 400, 'too_many_saved');
  await db.query(
    `with s as (insert into hg.saved_places (user_id, place_slug) values ($1, $2) on conflict do nothing returning 1)
     insert into hg.place_events (visitor_id, user_id, place_slug, action) select $3, $1, $2, 'save' where exists (select 1 from s)`,
    [req.user.id, slug, vid]);
  res.json({ places: await savedList(req.user.id) });
}));

router.delete('/me/saved/:slug', ah(async (req, res) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  const slug = req.params.slug;
  if (!SLUG.test(slug)) return fail(res, 400, 'bad_place');
  const vid = await v.ensureVisitor(req, res);
  await db.query(
    `with d as (delete from hg.saved_places where user_id = $1 and place_slug = $2 returning 1)
     insert into hg.place_events (visitor_id, user_id, place_slug, action) select $3, $1, $2, 'unsave' where exists (select 1 from d)`,
    [req.user.id, slug, vid]);
  res.json({ places: await savedList(req.user.id) });
}));

/* ---------- Questions asked to the AI consultant (saved with their answers as chats) ----------
   Signed in: your chats from any device, plus this browser's chats from before you signed in.
   Signed out: only this browser's chats that don't belong to an account. */
const OWNED = `((c.user_id is null and c.visitor_id = $1) or ($2::uuid is not null and c.user_id = $2))`;

router.post('/chats/messages', ah(async (req, res) => {
  const b = req.body || {};
  const question = text(b.question, 4000), answer = text(b.answer, 20000);
  if (!question || !answer) return fail(res, 400, 'empty_message');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['chat-visitor', vid, 120, 60]])) return fail(res, 429, 'too_many');
  let chatId = typeof b.chatId === 'string' && UUID.test(b.chatId) ? b.chatId : null;
  if (chatId && !(await db.one(`select 1 from hg.chats c where c.id = $3 and ${OWNED}`, [vid, uid(req), chatId]))) chatId = null;
  chatId = await db.transaction(async c => {
    const id = chatId || (await c.query(
      `insert into hg.chats (visitor_id, user_id, title) values ($1, $2, $3) returning id`,
      [vid, uid(req), question.slice(0, 140)])).rows[0].id;
    await c.query(`insert into hg.chat_messages (chat_id, role, text) values ($1, 'user', $2), ($1, 'assistant', $3)`, [id, question, answer]);
    await c.query(`update hg.chats set message_count = message_count + 2, updated_at = now() where id = $1`, [id]);
    return id;
  });
  res.json({ chatId });
}));

router.get('/chats', ah(async (req, res) => {
  const vid = v.visitorId(req, res);
  const rows = await db.many(
    `select c.id, c.title, c.message_count, c.updated_at from hg.chats c where ${OWNED} order by c.updated_at desc limit 50`,
    [vid, uid(req)]);
  res.json({ chats: rows.map(r => ({ id: r.id, title: r.title, messageCount: r.message_count, updatedAt: r.updated_at })) });
}));

router.get('/chats/:id', ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 404, 'not_found');
  const vid = v.visitorId(req, res);
  const chat = await db.one(`select c.id from hg.chats c where c.id = $3 and ${OWNED}`, [vid, uid(req), req.params.id]);
  if (!chat) return fail(res, 404, 'not_found');
  const messages = await db.many(`select role, text from hg.chat_messages where chat_id = $1 order by id`, [chat.id]);
  res.json({ id: chat.id, messages });
}));

/* ---------- Trip enquiries ---------- */
router.post('/enquiries', ah(async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.status(201).json({ ok: true }); // filled in by a bot
  const e = {
    name: text(b.name, 100), email: normEmail(b.email), message: text(b.message, 2000),
    dates: optText(b.dates, 100), place: optText(b.place, 120),
    travellers: Number.isInteger(b.travellers) && b.travellers >= 1 && b.travellers <= 50 ? b.travellers : null
  };
  if (!e.name) return fail(res, 400, 'name_required');
  if (!validEmail(e.email)) return fail(res, 400, 'invalid_email');
  if (!e.message) return fail(res, 400, 'message_required');
  const vid = await v.ensureVisitor(req, res);
  if (await sec.limited([['enquiry-ip', v.clientIp(req), 10, 60]])) return fail(res, 429, 'too_many');
  await db.query(
    `insert into hg.enquiries (visitor_id, user_id, name, email, dates, travellers, place, message) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [vid, uid(req), e.name, e.email, e.dates, e.travellers, e.place, e.message]);
  if (mail.configured() && config.adminEmails.length) {
    try { await mail.enquiryAlert(config.adminEmails[0], e, `${siteOrigin(req)}/admin#enquiries`); } catch (err) { console.error('Enquiry alert not sent:', err.message); }
  }
  res.status(201).json({ ok: true });
}));

module.exports = router;
