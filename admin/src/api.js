// Calls the Node.js + Express backend on the same site (/api/v1). The session cookie rides along.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api/v1' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (e) {
    throw Object.assign(new Error('network'), { code: 'network', status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty or not JSON */ }
  if (!res.ok) {
    const code = (data && data.error) || 'server_error';
    throw Object.assign(new Error(code), { code, status: res.status });
  }
  return data;
}

export const ERRORS = {
  invalid_credentials: 'That email and password don’t match.',
  missing_fields: 'Enter your email and password.',
  invalid_email: 'Enter a valid email address.',
  too_many: 'Too many attempts. Wait a few minutes and try again.',
  mail_not_configured: 'Emails aren’t switched on yet (add BREVO_API_KEY in Netlify).',
  not_configured: 'The database isn’t connected yet.',
  network: 'No connection. Check your internet and try again.'
};
export const errorText = e => ERRORS[e && e.code] || 'Something went wrong. Please try again.';
