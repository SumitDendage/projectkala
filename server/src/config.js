// Settings come from environment variables (Hostinger: your Node.js app → Environment variables).
const env = process.env;
const list = v => String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const adminEmails = list(env.ADMIN_EMAILS);

module.exports = {
  // Supabase → Connect → Transaction pooler → URI (with your database password filled in).
  databaseUrl: env.DATABASE_URL || '',
  // Supabase requires TLS. Set DATABASE_SSL=off only for a local test database.
  databaseSsl: env.DATABASE_SSL !== 'off',
  // Accounts that can open /admin (they must also confirm their email).
  adminEmails,
  // Brevo → SMTP & API → API keys. Used for password reset and confirmation emails.
  brevoKey: env.BREVO_API_KEY || '',
  // Sender address; must be a verified sender in Brevo. Defaults to the first admin email.
  mailFrom: (env.MAIL_FROM || adminEmails[0] || '').trim(),
  mailFromName: env.MAIL_FROM_NAME || 'India’s Hidden Gems',
  // Local testing only: write emails to this file instead of sending them.
  mailLog: env.MAIL_LOG || '',
  // Public address of the site, for links in emails. Defaults to the address the request came to.
  siteUrl: String(env.SITE_URL || '').replace(/\/+$/, ''),
  // Extra origins allowed to call the API (comma separated), besides the site itself.
  allowedOrigins: list(env.ALLOWED_ORIGINS),
  // Cookies are Secure (HTTPS only) unless COOKIE_SECURE=off (local http testing).
  secureCookies: env.COOKIE_SECURE !== 'off'
};
