/* Production server (Hostinger Node.js app, a VPS, or any Node.js host).
   Start command: node server/src/server.js   (or `npm start` from the project folder)
   Settings come from environment variables: see README.md → "Deploy on Hostinger". */
const { createWebApp } = require('./web');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';

createWebApp().listen(port, host, () => {
  console.log(`India's Hidden Gems is running on port ${port}`);
  if (!process.env.DATABASE_URL) console.log('DATABASE_URL is not set: accounts, saving and enquiries stay off.');
  if (!process.env.BREVO_API_KEY) console.log('BREVO_API_KEY is not set: confirmation and password emails stay off.');
});
