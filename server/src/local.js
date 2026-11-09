/* Run the whole site on your computer: the built site (../site) plus this backend at /api/v1.
   Example:
     DATABASE_URL=postgres://… ADMIN_EMAILS=you@example.com COOKIE_SECURE=off npm run dev
   Then open http://localhost:8787 (and http://localhost:8787/admin). */
const { createWebApp } = require('./web');

const port = Number(process.env.PORT) || 8787;
createWebApp().listen(port, '127.0.0.1', () => {
  console.log(`India's Hidden Gems running at http://localhost:${port}`);
  require('./reminders').start();
});
