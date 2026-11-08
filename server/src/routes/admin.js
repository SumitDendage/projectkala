/* Admin dashboard data. Only accounts listed in ADMIN_EMAILS, with a confirmed email, get in. */
const express = require('express');
const config = require('../config');
const db = require('../db');
const mail = require('../mail');
const { ah, fail, text, UUID, isAdmin, paging } = require('../http');

const router = express.Router();
const TZ = process.env.REPORT_TZ || 'Asia/Kolkata';
const NOT_BOT = `coalesce(device, '') <> 'Bot'`;

router.use((req, res, next) => {
  if (!req.user) return fail(res, 401, 'sign_in');
  if (!isAdmin(req.user)) return fail(res, 403, req.user.email_verified_at ? 'not_admin' : 'confirm_email');
  next();
});

// Text search that treats % and _ literally.
const like = s => `%${String(s).replace(/[\\%_]/g, m => '\\' + m)}%`;
const searchOf = req => text(req.query.search, 100);
const total = rows => (rows.length ? Number(rows[0].total) : 0);
const strip = rows => rows.map(({ total: _t, ...r }) => r);

router.get('/status', (req, res) => res.json({
  database: true, mail: mail.configured(), mailFrom: config.mailFrom ? config.mailFrom.replace(/^(.).*(@.*)$/, '$1…$2') : null,
  admins: config.adminEmails.length, timezone: TZ
}));

router.get('/overview', ah(async (req, res) => {
  const [counts, daily, countries, devices, questions, places] = await Promise.all([
    db.one(`select
      (select count(*) from hg.visitors where ${NOT_BOT})::int as visitors,
      (select count(*) from hg.visitors where ${NOT_BOT} and last_seen > now() - interval '7 days')::int as visitors_7d,
      (select count(*) from hg.visits where ${NOT_BOT} and created_at > now() - interval '1 day')::int as visits_24h,
      (select count(*) from hg.users)::int as accounts,
      (select count(*) from hg.users where email_verified_at is not null)::int as verified,
      (select count(*) from hg.users where created_at > now() - interval '7 days')::int as accounts_7d,
      (select count(*) from hg.chat_messages where role = 'user')::int as questions,
      (select count(*) from hg.chat_messages where role = 'user' and created_at > now() - interval '7 days')::int as questions_7d,
      (select count(*) from hg.saved_places)::int as saved,
      (select count(*) from hg.enquiries where status = 'new')::int as new_enquiries`),
    db.many(`select to_char(d, 'YYYY-MM-DD') as day, coalesce(n, 0)::int as visits
      from generate_series((now() at time zone $1)::date - 13, (now() at time zone $1)::date, interval '1 day') d
      left join (select (created_at at time zone $1)::date as day, count(*) as n from hg.visits
                 where ${NOT_BOT} and created_at > now() - interval '15 days' group by 1) v on v.day = d::date
      order by d`, [TZ]),
    db.many(`select coalesce(country, 'Unknown') as label, count(*)::int as n from hg.visitors where ${NOT_BOT} group by 1 order by 2 desc limit 6`),
    db.many(`select coalesce(device, 'Unknown') as label, count(*)::int as n from hg.visitors where ${NOT_BOT} group by 1 order by 2 desc`),
    db.many(`select m.text, m.created_at, v.country, v.city, u.name as user_name
      from hg.chat_messages m join hg.chats c on c.id = m.chat_id join hg.visitors v on v.id = c.visitor_id
      left join hg.users u on u.id = c.user_id where m.role = 'user' order by m.created_at desc limit 8`),
    db.many(`select place_slug as slug, count(*) filter (where action = 'view')::int as views,
      count(*) filter (where action = 'save')::int as saves from hg.place_events group by 1 order by 2 desc limit 9`)
  ]);
  res.json({ counts, daily, countries, devices, questions, places });
}));

router.get('/visitors', ah(async (req, res) => {
  const { page, limit, offset } = paging(req), s = searchOf(req), bots = req.query.bots === '1';
  const rows = await db.many(
    `select v.id, v.first_seen, v.last_seen, v.visit_count, v.country, v.region, v.city, v.device, v.browser, v.os,
       u.id as user_id, u.name as user_name, u.email as user_email,
       (select count(*) from hg.chat_messages m join hg.chats c on c.id = m.chat_id where c.visitor_id = v.id and m.role = 'user')::int as questions,
       (select count(*) from hg.place_events p where p.visitor_id = v.id and p.action = 'view')::int as place_views,
       count(*) over () as total
     from hg.visitors v left join hg.users u on u.id = v.user_id
     where ($1 or coalesce(v.device, '') <> 'Bot')
       and ($2 = '' or concat_ws(' ', v.country, v.region, v.city, v.device, v.browser, v.os, u.name, u.email) ilike $3)
     order by v.last_seen desc limit $4 offset $5`,
    [bots, s, like(s), limit, offset]);
  res.json({ page, pageSize: limit, total: total(rows), rows: strip(rows) });
}));

router.get('/visitors/:id', ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 404, 'not_found');
  const visitor = await db.one(
    `select v.*, u.name as user_name, u.email as user_email, u.email_verified_at, u.created_at as user_created_at
     from hg.visitors v left join hg.users u on u.id = v.user_id where v.id = $1`, [req.params.id]);
  if (!visitor) return fail(res, 404, 'not_found');
  const [visits, chats, places, saved] = await Promise.all([
    db.many(`select created_at, path, referrer, country, region, city, device, browser, os, language, timezone
             from hg.visits where visitor_id = $1 order by created_at desc limit 100`, [visitor.id]),
    db.many(`select c.id, c.title, c.created_at, c.updated_at,
               coalesce(json_agg(json_build_object('role', m.role, 'text', m.text, 'at', m.created_at) order by m.id)
                 filter (where m.id is not null), '[]') as messages
             from hg.chats c left join hg.chat_messages m on m.chat_id = c.id
             where c.visitor_id = $1 group by c.id order by c.updated_at desc limit 30`, [visitor.id]),
    db.many(`select place_slug as slug, action, created_at from hg.place_events where visitor_id = $1 order by created_at desc limit 100`, [visitor.id]),
    visitor.user_id ? db.many(`select place_slug as slug, created_at from hg.saved_places where user_id = $1 order by created_at`, [visitor.user_id]) : []
  ]);
  res.json({ visitor, visits, chats, places, saved });
}));

router.get('/users', ah(async (req, res) => {
  const { page, limit, offset } = paging(req), s = searchOf(req);
  const rows = await db.many(
    `select u.id, u.name, u.email, u.email_verified_at, u.created_at, u.last_login_at,
       (select count(*) from hg.saved_places sp where sp.user_id = u.id)::int as saved,
       (select count(*) from hg.chat_messages m join hg.chats c on c.id = m.chat_id where c.user_id = u.id and m.role = 'user')::int as questions,
       (select max(last_seen) from hg.visitors v where v.user_id = u.id) as last_seen,
       (select v.id from hg.visitors v where v.user_id = u.id order by v.last_seen desc limit 1) as visitor_id,
       count(*) over () as total
     from hg.users u
     where ($1 = '' or concat_ws(' ', u.name, u.email) ilike $2)
     order by u.created_at desc limit $3 offset $4`,
    [s, like(s), limit, offset]);
  res.json({ page, pageSize: limit, total: total(rows), rows: strip(rows).map(r => ({ ...r, is_admin: config.adminEmails.includes(r.email) })) });
}));

router.get('/questions', ah(async (req, res) => {
  const { page, limit, offset } = paging(req), s = searchOf(req);
  const rows = await db.many(
    `select m.id, m.text, m.created_at, c.id as chat_id, c.visitor_id, v.country, v.city, v.device,
       u.name as user_name, u.email as user_email,
       (select left(a.text, 700) from hg.chat_messages a where a.chat_id = m.chat_id and a.id > m.id and a.role = 'assistant' order by a.id limit 1) as answer,
       count(*) over () as total
     from hg.chat_messages m join hg.chats c on c.id = m.chat_id join hg.visitors v on v.id = c.visitor_id
     left join hg.users u on u.id = c.user_id
     where m.role = 'user' and ($1 = '' or m.text ilike $2)
     order by m.created_at desc limit $3 offset $4`,
    [s, like(s), limit, offset]);
  res.json({ page, pageSize: limit, total: total(rows), rows: strip(rows) });
}));

router.get('/places', ah(async (req, res) => {
  const [stats, savedNow, recent] = await Promise.all([
    db.many(`select place_slug as slug,
               count(*) filter (where action = 'view')::int as views,
               count(distinct visitor_id) filter (where action = 'view')::int as viewers,
               count(*) filter (where action = 'save')::int as saves,
               count(*) filter (where action = 'unsave')::int as unsaves,
               max(created_at) filter (where action = 'view') as last_viewed
             from hg.place_events group by 1`),
    db.many(`select place_slug as slug, count(*)::int as n from hg.saved_places group by 1`),
    db.many(`select p.place_slug as slug, p.action, p.created_at, p.visitor_id, v.country, v.city, u.name as user_name
             from hg.place_events p join hg.visitors v on v.id = p.visitor_id left join hg.users u on u.id = p.user_id
             order by p.created_at desc limit 60`)
  ]);
  const saved = Object.fromEntries(savedNow.map(r => [r.slug, r.n]));
  res.json({ places: stats.map(r => ({ ...r, saved_now: saved[r.slug] || 0 })), recent });
}));

router.get('/enquiries', ah(async (req, res) => {
  const status = ['new', 'contacted', 'closed'].includes(req.query.status) ? req.query.status : '';
  const rows = await db.many(
    `select e.*, v.country, v.city from hg.enquiries e left join hg.visitors v on v.id = e.visitor_id
     where ($1 = '' or e.status = $1) order by e.created_at desc limit 200`, [status]);
  res.json({ rows });
}));

router.patch('/enquiries/:id', ah(async (req, res) => {
  const status = (req.body || {}).status;
  if (!UUID.test(req.params.id) || !['new', 'contacted', 'closed'].includes(status)) return fail(res, 400, 'bad_request');
  const row = await db.one(`update hg.enquiries set status = $2 where id = $1 returning id, status`, [req.params.id, status]);
  if (!row) return fail(res, 404, 'not_found');
  res.json(row);
}));

router.get('/chats/:id', ah(async (req, res) => {
  if (!UUID.test(req.params.id)) return fail(res, 404, 'not_found');
  const chat = await db.one(
    `select c.*, v.country, v.city, u.name as user_name from hg.chats c join hg.visitors v on v.id = c.visitor_id
     left join hg.users u on u.id = c.user_id where c.id = $1`, [req.params.id]);
  if (!chat) return fail(res, 404, 'not_found');
  const messages = await db.many(`select role, text, created_at from hg.chat_messages where chat_id = $1 order by id`, [chat.id]);
  res.json({ chat, messages });
}));

module.exports = router;
