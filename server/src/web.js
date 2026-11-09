/* The whole site from one Node.js process: the website (../site), the React admin dashboard
   (/admin), the backend (/api/v1) and the AI consultant (/api/chat, answered by Claude).
   Used by server.js (production, e.g. Hostinger) and local.js (your computer). */
const path = require('path');
const express = require('express');
const { createApp } = require('./app');
const chat = require('./chat');

const SITE = path.resolve(process.env.SITE_DIR || path.join(__dirname, '../../site'));

function createWebApp() {
  const app = createApp();

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.use(chat);
  app.use(require('./placeinfo'));

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
