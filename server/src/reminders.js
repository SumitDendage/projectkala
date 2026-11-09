/* Season reminders: once an hour, email everyone whose place's best months begin this month and who
   hasn't had this month's email yet. Each email is claimed in the database before it's sent, so two
   copies of the app never send the same one. Months follow REPORT_TZ (default India time). */
const config = require('./config');
const db = require('./db');
const mail = require('./mail');
const { PLACES, BY_SLUG } = require('./places');

const TZ = process.env.REPORT_TZ || 'Asia/Kolkata';

function currentMonth(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(date).map(p => [p.type, p.value]));
  return { key: `${parts.year}-${parts.month}`, month: Number(parts.month) };
}

async function runOnce(date = new Date()) {
  if (!db.configured() || !mail.configured()) return { sent: 0, failed: 0, skipped: 'not configured' };
  if (!config.siteUrl) return { sent: 0, failed: 0, skipped: 'SITE_URL is not set' };
  const { key, month } = currentMonth(date);
  const slugs = PLACES.filter(p => p.starts.includes(month)).map(p => p.slug);
  if (!slugs.length) return { sent: 0, failed: 0 };
  const due = await db.many(
    `select id from hg.season_alerts
     where place_slug = any($1) and confirmed_at is not null and stopped_at is null and last_sent_month is distinct from $2
     order by created_at limit 500`, [slugs, key]);
  let sent = 0, failed = 0;
  for (const { id } of due) {
    const a = await db.one(
      `update hg.season_alerts set last_sent_month = $2, last_sent_at = now()
       where id = $1 and stopped_at is null and last_sent_month is distinct from $2 returning email, place_slug, stop_token`, [id, key]);
    if (!a) continue; // another copy of the app took it
    const place = BY_SLUG[a.place_slug];
    try {
      await mail.seasonReminder(a.email, place, `${config.siteUrl}/?plan=${a.place_slug}#consultant`, `${config.siteUrl}/?stop-reminder=${a.stop_token}`);
      sent++;
    } catch (err) {
      failed++;
      console.error('Season reminder not sent:', err.message);
      await db.query(`update hg.season_alerts set last_sent_month = null where id = $1`, [id]).catch(() => {});
    }
  }
  if (sent || failed) console.log(`Season reminders for ${key}: ${sent} sent${failed ? `, ${failed} failed (retried next hour)` : ''}.`);
  return { sent, failed };
}

// Started by server.js / local.js. Set REMINDERS=off to turn the hourly run off.
function start() {
  if (process.env.REMINDERS === 'off') return;
  const run = () => runOnce().catch(err => console.error('Season reminders:', err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

module.exports = { currentMonth, runOnce, start };
