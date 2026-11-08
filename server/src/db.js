const { Pool } = require('pg');
const config = require('./config');

let pool = null;

// Use the URL's settings, but let `ssl` below decide TLS (a ?sslmode in the URL would override it).
function cleanUrl(url) {
  try {
    const u = new URL(url);
    ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].forEach(k => u.searchParams.delete(k));
    return u.toString();
  } catch (e) {
    return url;
  }
}

function getPool() {
  if (!config.databaseUrl) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: cleanUrl(config.databaseUrl),
      // Encrypted connection. Supabase signs with its own CA, so the chain isn't checked here.
      ssl: config.databaseSsl ? { rejectUnauthorized: false } : false,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000
    });
    pool.on('error', err => console.error('Database pool error:', err.message));
  }
  return pool;
}

const query = (text, params) => getPool().query(text, params);
const one = async (text, params) => (await query(text, params)).rows[0] || null;
const many = async (text, params) => (await query(text, params)).rows;

async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { getPool, query, one, many, transaction, configured: () => !!config.databaseUrl };
