const fs = require('fs');
const config = require('./config');

const configured = () => !!(config.mailLog || (config.brevoKey && config.mailFrom));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One simple, readable layout for every email.
function layout({ heading, intro, button, link, outro }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f1f3f2;font-family:Arial,Helvetica,sans-serif;color:#0c1014">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#8f5100;padding-bottom:16px">India’s Hidden Gems</td></tr>
<tr><td style="font-size:24px;font-weight:bold;padding-bottom:12px">${esc(heading)}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#4b545d;padding-bottom:24px">${esc(intro)}</td></tr>
${link ? `<tr><td style="padding-bottom:24px"><a href="${esc(link)}" style="display:inline-block;background:#f5a524;color:#07090c;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:999px">${esc(button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#4b545d;padding-bottom:16px">Or open this link: <a href="${esc(link)}" style="color:#8f5100;word-break:break-all">${esc(link)}</a></td></tr>` : ''}
<tr><td style="font-size:13px;line-height:1.6;color:#4b545d">${esc(outro || '')}</td></tr>
</table></td></tr></table></body></html>`;
  const text = [heading, '', intro, '', link ? `${button}: ${link}` : '', '', outro || ''].join('\n').trim();
  return { html, text };
}

async function send({ to, subject, ...content }) {
  const { html, text } = layout(content);
  if (config.mailLog) {
    fs.appendFileSync(config.mailLog, JSON.stringify({ to, subject, text, link: content.link || null, at: new Date().toISOString() }) + '\n');
    return;
  }
  if (!config.brevoKey || !config.mailFrom) throw new Error('mail_not_configured');
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': config.brevoKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ sender: { email: config.mailFrom, name: config.mailFromName }, to: [{ email: to }], subject, htmlContent: html, textContent: text })
  });
  if (!res.ok) throw new Error(`Brevo answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const resetEmail = (to, name, link) => send({
  to, subject: 'Reset your password',
  heading: 'Choose a new password', intro: `Hi ${name}, we got a request to reset the password for your India’s Hidden Gems account. The link works for one hour.`,
  button: 'Choose a new password', link,
  outro: 'If you didn’t ask for this, you can ignore this email. Your password won’t change.'
});

const verifyEmail = (to, name, link) => send({
  to, subject: 'Confirm your email address',
  heading: 'Confirm your email', intro: `Hi ${name}, welcome to India’s Hidden Gems. Confirm this is your email address so you can always get back into your account.`,
  button: 'Confirm my email', link,
  outro: 'If you didn’t create an account, you can ignore this email.'
});

const enquiryAlert = (to, e, adminLink) => send({
  to, subject: `New trip enquiry from ${e.name}`,
  heading: 'New trip enquiry',
  intro: `${e.name} (${e.email}) wrote: “${e.message}”${e.place ? ` Place: ${e.place}.` : ''}${e.dates ? ` When: ${e.dates}.` : ''}${e.travellers ? ` Travellers: ${e.travellers}.` : ''}`,
  button: 'Open the admin dashboard', link: adminLink
});

module.exports = { configured, resetEmail, verifyEmail, enquiryAlert };
