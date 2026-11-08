/* Run the whole site on your computer: the built site (../site) plus this backend at /api/v1.
   Example:
     DATABASE_URL=postgres://… ADMIN_EMAILS=you@example.com COOKIE_SECURE=off npm run dev
   Then open http://localhost:8787 (and http://localhost:8787/admin). */
const path = require('path');
const express = require('express');
const { createApp } = require('./app');

const app = createApp();
const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../site'));
const CHAT_URL = process.env.CHAT_URL || 'https://storied-otter-d8b50e.netlify.app/api/chat';

// The AI consultant runs on the live site; pass questions through so the local copy can chat too.
app.post('/api/chat', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  try {
    const r = await fetch(CHAT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: req.body });
    res.status(r.status).set('content-type', r.headers.get('content-type') || 'text/event-stream');
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) {
    res.status(502).json({ error: 'chat_unreachable' });
  }
});

app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(SITE, 'admin', 'index.html')));
app.use(express.static(SITE));

const port = Number(process.env.PORT) || 8787;
app.listen(port, '127.0.0.1', () => console.log(`India's Hidden Gems running at http://localhost:${port}`));
