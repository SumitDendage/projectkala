import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from './api.js';
import Overview from './components/Overview.jsx';
import { Accounts, Enquiries, Places, Questions, Visitors } from './components/Lists.jsx';
import { ChatPanel, VisitorPanel } from './components/Panels.jsx';
import { Finder, Gems } from './components/Features.jsx';

const TABS = [
  ['overview', 'Overview'], ['visitors', 'Visitors'], ['accounts', 'Accounts'],
  ['questions', 'Questions'], ['places', 'Places'], ['finder', 'Gem Finder'], ['gems', 'Traveller gems'], ['enquiries', 'Enquiries']
];
const tabFromHash = () => {
  const h = location.hash.replace(/^#/, '');
  return TABS.some(([id]) => id === h) ? h : 'overview';
};

const Logo = () => (
  <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14.6" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M5.6 22.4 12.4 12.2l4.1 5.6 3-3.9 6.9 8.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" /><circle cx="21.6" cy="9.6" r="2.3" fill="#f5a524" /></svg>
);

function Bar({ me, onSignOut }) {
  return (
    <header className="bar">
      <div className="wrap bar-in">
        <a className="brand" href="/"><Logo /><span>India’s Hidden Gems</span></a>
        <span className="badge">Admin</span>
        {me && (
          <div className="me">
            <span>{me.name}</span>
            <button className="btn ghost sm" type="button" onClick={onSignOut}>Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}

function SignIn({ onSignedIn }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [note, setNote] = useState({ text: '', kind: '' });
  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !password) { setNote({ text: 'Enter your email and password.', kind: 'err' }); return; }
    setBusy(true); setNote({ text: '', kind: '' });
    try { const d = await api('/auth/signin', { method: 'POST', body: { email, password } }); setPassword(''); onSignedIn(d.user); }
    catch (err) { setNote({ text: errorText(err), kind: 'err' }); }
    finally { setBusy(false); }
  }
  async function forgot() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setNote({ text: 'Type your email above, then choose Forgot password again.', kind: 'err' }); return; }
    try {
      await api('/auth/forgot', { method: 'POST', body: { email } });
      setNote({ text: `If an account exists for ${email.trim()}, a reset link is on its way. It opens the site, where you choose a new password.`, kind: 'ok' });
    } catch (err) { setNote({ text: errorText(err), kind: 'err' }); }
  }
  return (
    <section className="gate" aria-labelledby="gateTitle">
      <h1 id="gateTitle">Site <em>admin</em></h1>
      <p>Sign in with an account whose email is listed in <code>ADMIN_EMAILS</code>. No account yet? Create one on the site first, using that email.</p>
      <form onSubmit={submit} noValidate>
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
        <div className="gate-row">
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button className="link" type="button" onClick={forgot}>Forgot password?</button>
        </div>
        {note.text && <p className={'note ' + note.kind} role={note.kind === 'err' ? 'alert' : 'status'}>{note.text}</p>}
      </form>
    </section>
  );
}

function NotAdmin({ me, onRecheck, onSignOut }) {
  const [note, setNote] = useState('');
  if (!me.emailVerified) {
    return (
      <section className="gate">
        <h1>Confirm your <em>email</em></h1>
        <p>For safety, the admin only opens for confirmed email addresses. Open the confirmation link we emailed to <strong>{me.email}</strong>, then choose “I’ve confirmed it”.</p>
        <div className="gate-row">
          <button className="btn primary" type="button" onClick={onRecheck}>I’ve confirmed it</button>
          <button className="link" type="button" onClick={async () => {
            try { await api('/auth/resend-verification', { method: 'POST' }); setNote(`Confirmation link sent to ${me.email}.`); } catch (e) { setNote(errorText(e)); }
          }}>Send the link again</button>
        </div>
        {note && <p className="note" role="status">{note}</p>}
        <button className="link" type="button" onClick={onSignOut}>Use another account</button>
      </section>
    );
  }
  return (
    <section className="gate">
      <h1>Not an <em>admin</em></h1>
      <p><strong>{me.email}</strong> isn’t an admin. Add it to <code>ADMIN_EMAILS</code> in your Node.js app’s environment variables on Hostinger, restart the app, then sign in.</p>
      <div className="gate-row"><button className="btn primary" type="button" onClick={onSignOut}>Use another account</button></div>
    </section>
  );
}

const Setup = () => (
  <section className="gate">
    <h1>Almost <em>ready</em></h1>
    <p>The backend is running, but its database isn’t connected yet. In Hostinger, open your Node.js app’s environment variables and add <code>DATABASE_URL</code> (from Supabase → Connect → Transaction pooler), then deploy again.</p>
  </section>
);

export default function App() {
  const [me, setMe] = useState(undefined); // undefined while loading, null when signed out
  const [setup, setSetup] = useState(false), [failed, setFailed] = useState(null);
  const [status, setStatus] = useState(null), [newEnquiries, setNewEnquiries] = useState(0), [newGems, setNewGems] = useState(0);
  const [tab, setTab] = useState(tabFromHash);
  const [visitor, setVisitor] = useState(null), [chat, setChat] = useState(null);

  const loadMe = useCallback(() => {
    api('/auth/me').then(d => { setMe(d.user); setFailed(null); }, e => {
      if (e.code === 'not_configured') setSetup(true); else setFailed(e);
      setMe(null);
    });
  }, []);
  useEffect(loadMe, [loadMe]);
  useEffect(() => {
    const on = () => setTab(tabFromHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  const countNew = useCallback(() => api('/admin/enquiries?status=new').then(d => setNewEnquiries(d.rows.length), () => {}), []);
  const countGems = useCallback(() => api('/admin/gems?status=pending').then(d => setNewGems(d.rows.length), () => {}), []);
  useEffect(() => {
    if (!me || !me.isAdmin) return;
    api('/admin/status').then(setStatus, () => {});
    countNew(); countGems();
  }, [me, countNew, countGems]);

  const go = id => { if (location.hash !== '#' + id) location.hash = id; setTab(id); window.scrollTo(0, 0); };
  async function signOut() {
    try { await api('/auth/signout', { method: 'POST' }); } catch (e) { /* the cookie expires anyway */ }
    setMe(null); setStatus(null);
  }
  const closeVisitor = useCallback(() => setVisitor(null), []);
  const closeChat = useCallback(() => setChat(null), []);

  let body;
  if (me === undefined) body = <p className="muted">Loading…</p>;
  else if (setup) body = <Setup />;
  else if (failed) body = <section className="gate"><h1>Can’t reach the <em>backend</em></h1><p>{errorText(failed)}</p><div className="gate-row"><button className="btn primary" type="button" onClick={loadMe}>Try again</button></div></section>;
  else if (!me) body = <SignIn onSignedIn={setMe} />;
  else if (!me.isAdmin) body = <NotAdmin me={me} onRecheck={loadMe} onSignOut={signOut} />;
  else {
    const open = { onOpenVisitor: setVisitor, onOpenChat: setChat, onOpenTab: go };
    body = (
      <>
        <nav className="tabs" role="tablist" aria-label="Admin sections">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => go(id)}>
              {label}{id === 'enquiries' && newEnquiries > 0 && <span className="count" aria-label={`${newEnquiries} new`}>{newEnquiries}</span>}
              {id === 'gems' && newGems > 0 && <span className="count" aria-label={`${newGems} waiting for review`}>{newGems}</span>}
            </button>
          ))}
        </nav>
        <div role="tabpanel">
          {tab === 'overview' && <Overview status={status} {...open} />}
          {tab === 'visitors' && <Visitors {...open} />}
          {tab === 'accounts' && <Accounts {...open} />}
          {tab === 'questions' && <Questions {...open} />}
          {tab === 'places' && <Places {...open} />}
          {tab === 'finder' && <Finder {...open} />}
          {tab === 'gems' && <Gems onChanged={countGems} />}
          {tab === 'enquiries' && <Enquiries onChanged={countNew} />}
        </div>
        {visitor && <VisitorPanel id={visitor} onClose={closeVisitor} />}
        {chat && <ChatPanel id={chat} onClose={closeChat} />}
      </>
    );
  }
  return (
    <>
      <Bar me={me && me.isAdmin ? me : null} onSignOut={signOut} />
      <main className="wrap">{body}</main>
    </>
  );
}
