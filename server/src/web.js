/* The whole site from one Node.js process: the website (../site), the React admin dashboard
   (/admin), the backend (/api/v1) and the AI consultant (/api/chat, passed through to the
   Lovable app that answers it). Used by server.js (production, e.g. Hostinger) and local.js. */
const path = require('path');
const express = require('express');
const { createApp } = require('./app');

const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../site'));
const CHAT_URL = process.env.CHAT_URL || 'https://storied-otter-d8b50e.netlify.app/api/chat';

function createWebApp() {
  const app = createApp();

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // The AI consultant: questions go to the chat service and its streamed answer comes straight back.
  app.post('/api/chat', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    try {
      const r = await fetch(CHAT_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: req.body });
      res.status(r.status).set('content-type', r.headers.get('content-type') || 'text/event-stream');
      res.set('Cache-Control', 'no-store');
      for await (const chunk of r.body) res.write(chunk);
      res.end();
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ error: 'chat_unreachable' });
      else res.end();
    }
  });

  // Netlify-only file; not part of this site.
  app.get('/_redirects', (req, res) => res.status(404).end());

  app.get(['/admin', '/admin/'], (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(SITE, 'admin', 'index.html'));
  });
  app.use(express.static(SITE, {
    setHeaders(res, file) {
      // Pages always fresh; fingerprinted and versioned files cached for a long time.
      if (file.endsWith('.html')) res.set('Cache-Control', 'no-cache');
      else if (/[\\/](admin[\\/]assets|vendor|fonts)[\\/]/.test(file)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
      else res.set('Cache-Control', 'public, max-age=86400');
    }
  }));
  app.use((req, res) => res.status(404).sendFile(path.join(SITE, 'index.html')));
  return app;
}

module.exports = { createWebApp };
