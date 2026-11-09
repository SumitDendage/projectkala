/* Pictures for the places the AI consultant suggests: GET /api/place-info?title=<Wikipedia title>&q=<name, state>
   Looks the place up on Wikipedia and returns a photo (freely licensed, from Wikimedia Commons), a short
   description and coordinates. Results are cached for a day. Places outside India are ignored, so a wrong
   match never shows a wrong photo. Works without the database. */
const express = require('express');
const config = require('./config');
const { clientIp } = require('./visitor');

const BASE = (process.env.WIKI_BASE || 'https://en.wikipedia.org').replace(/\/+$/, '');
// Wikimedia asks API clients to say who they are.
const UA = `IndiasHiddenGems/1.0 (${config.siteUrl || 'https://github.com/SumitDendage/projectkala'})`;
const DAY = 24 * 60 * 60 * 1000;
const cache = new Map(); // key -> { at, data }
const hits = new Map(); // ip -> [times], 120 lookups an hour

const inIndia = c => c && c.lat > 5 && c.lat < 38 && c.lon > 67 && c.lon < 99;
const clip = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length <= n) return s;
  const cut = s.slice(0, n), end = cut.lastIndexOf('. ');
  return end > n * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, '') + '…';
};

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'api-user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  return res.json();
}

const summary = title => getJson(`${BASE}/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`);

async function search(q) {
  const d = await getJson(`${BASE}/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(q)}`);
  const hit = d && d.query && d.query.search && d.query.search[0];
  return hit ? hit.title : null;
}

// Only freely licensed photos from Wikimedia Commons (not fair-use images stored on English Wikipedia).
function photo(s) {
  const src = s.originalimage && s.originalimage.source;
  const thumb = s.thumbnail && s.thumbnail.source;
  if (!src || !/\/wikipedia\/commons\//.test(src)) return { image: null, file: null };
  const name = decodeURIComponent(src.split('/').pop());
  // Ask for a picture about 800 px wide when Wikipedia offers a resized one.
  const image = thumb && /\/\d+px-/.test(thumb) ? thumb.replace(/\/\d+px-/, '/800px-') : src;
  return { image, file: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name.replace(/ /g, '_'))}` };
}

function shape(s) {
  if (!s || s.type === 'disambiguation' || !s.title) return null;
  if (s.coordinates && !inIndia(s.coordinates)) return null;
  return {
    found: true,
    title: s.title,
    description: clip(s.description, 120) || null,
    extract: clip(s.extract, 280) || null,
    ...photo(s),
    url: (s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page) || null,
    lat: s.coordinates ? s.coordinates.lat : null,
    lon: s.coordinates ? s.coordinates.lon : null
  };
}

async function lookup(title, q) {
  let found = title ? shape(await summary(title)) : null;
  if (!found && q) {
    const t = await search(q);
    if (t && t !== title) found = shape(await summary(t));
  }
  return found || { found: false };
}

const router = express.Router();
router.get('/api/place-info', async (req, res) => {
  const title = String(req.query.title || '').trim().slice(0, 120);
  const q = String(req.query.q || '').trim().slice(0, 120);
  if (!title && !q) return res.status(400).json({ error: 'bad_request' });
  const ip = clientIp(req), now = Date.now();
  const mine = (hits.get(ip) || []).filter(t => t > now - 60 * 60 * 1000);
  if (mine.length >= 120) return res.status(429).json({ error: 'too_many' });
  mine.push(now); hits.set(ip, mine);
  if (hits.size > 5000) hits.clear();

  const key = `${title.toLowerCase()}|${q.toLowerCase()}`;
  const hit = cache.get(key);
  let data = hit && now - hit.at < DAY ? hit.data : null;
  if (!data) {
    try {
      data = await lookup(title, q);
      cache.set(key, { at: now, data });
      if (cache.size > 1000) cache.delete(cache.keys().next().value);
    } catch (e) {
      data = { found: false }; // Wikipedia didn't answer: try again next time
    }
  }
  res.set('Cache-Control', 'public, max-age=86400');
  res.json(data);
});

module.exports = router;
