import { useState } from 'react';
import { api, errorText } from '../api.js';
import { Card, Empty, Failed, HBars, StatTile, useApi } from './ui.jsx';
import { ago, dateTime, n, place, placeName, placeState } from '../format.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LAND = { mountains: 'Mountains', water: 'On the water', forest: 'Forest and hills', desert: 'Desert', heritage: 'Heritage' };
const EFFORT = ['', 'Easy going', 'Some walking', 'Treks and altitude'];
const BUDGET = ['', 'Under ₹3,000', '₹3,000–5,000', 'Over ₹5,000'];

/* ---------- Gem Finder: what people look for ---------- */
export function Finder({ onOpenVisitor }) {
  const { data, error, loading, reload } = useApi('/admin/finder');
  if (!data) return error ? <Failed error={error} onRetry={reload} /> : <p className="muted">Loading…</p>;
  const c = data.counts;
  const byMonth = Object.fromEntries(data.months.map(r => [r.month, r.n]));
  const levels = (rows, names) => rows.map(r => ({ label: names[r.level] || String(r.level), n: r.n }));
  const answers = r => [r.month ? MONTHS[r.month - 1] : 'Any month', r.landscape ? LAND[r.landscape] : null, r.effort ? EFFORT[r.effort] : null, r.budget ? BUDGET[r.budget] : null].filter(Boolean).join(' · ');
  return (
    <div className={loading ? 'loading' : ''}>
      <div className="head">
        <div><h2>Gem Finder</h2><p>The four-question match on the site: when people want to travel, what they look for, and the places it suggested.</p></div>
        <button className="btn ghost sm" type="button" onClick={reload}>Refresh</button>
      </div>
      <div className="stats">
        <StatTile label="Times used" value={c.runs} sub={`${n(c.runs_7d)} in the last 7 days`} />
        <StatTile label="People" value={c.people} sub="Different browsers" />
      </div>
      {!c.runs ? <Card><Empty>Nobody has used Gem Finder yet.</Empty></Card> : (
        <>
          <div className="grid two" style={{ marginBottom: 16 }}>
            <Card title="When they want to go" aside="Month picked">
              <HBars rows={MONTHS.map((m, i) => ({ label: m, n: byMonth[i + 1] || 0 }))} />
            </Card>
            <div className="grid">
              <Card title="What pulls them"><HBars rows={data.landscapes.map(r => ({ label: LAND[r.label] || r.label, n: r.n }))} empty="No landscape picked yet." /></Card>
              <Card title="Best match it suggested"><HBars rows={data.results.map(r => ({ label: placeName(r.slug), n: r.n }))} /></Card>
            </div>
          </div>
          <div className="grid two" style={{ marginBottom: 16 }}>
            <Card title="How active"><HBars rows={levels(data.efforts, EFFORT)} empty="Nobody picked this yet." /></Card>
            <Card title="Daily budget"><HBars rows={levels(data.budgets, BUDGET)} empty="Nobody picked this yet." /></Card>
          </div>
          <Card title="Latest" flush>
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Answers</th><th>Matches, best first</th><th>From</th><th /></tr></thead>
                <tbody>
                  {data.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{ago(r.created_at)}</td>
                      <td>{answers(r)}</td>
                      <td>{r.results.map(placeName).join(', ')}</td>
                      <td>{place(r.city, r.country)}{r.user_name && <small>{r.user_name}</small>}</td>
                      <td><button className="link" type="button" onClick={() => onOpenVisitor(r.visitor_id)}>Visitor</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

/* ---------- Traveller gems: approve before they appear on the site ---------- */
const STATUS = { pending: ['Waiting', 'warn'], approved: ['On the site', 'ok'], rejected: ['Rejected', 'muted'] };
export function Gems({ onChanged }) {
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState(null), [msg, setMsg] = useState('');
  const { data, error, loading, reload } = useApi('/admin/gems' + (status ? '?status=' + status : ''));
  async function act(id, how) {
    if (how === 'delete' && !window.confirm('Delete this gem for good?')) return;
    setBusy(id); setMsg('');
    try {
      if (how === 'delete') await api('/admin/gems/' + id, { method: 'DELETE' });
      else await api('/admin/gems/' + id, { method: 'PATCH', body: { status: how } });
      reload(); onChanged && onChanged();
    } catch (e) { setMsg(errorText(e)); }
    finally { setBusy(null); }
  }
  return (
    <div>
      <div className="head">
        <div><h2>Traveller gems</h2><p>Places visitors shared. Approve the good ones to show them in Traveller gems on the site; emails are never shown there.</p></div>
        <label className="tools"><span className="sr">Show</span>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="pending">Waiting for review</option><option value="approved">On the site</option><option value="rejected">Rejected</option><option value="">All</option>
          </select>
        </label>
      </div>
      {msg && <p className="note err" role="alert">{msg}</p>}
      <Card flush>
        {!data ? (error ? <Failed error={error} onRetry={reload} /> : <Empty>Loading…</Empty>) : data.rows.length === 0
          ? <Empty>{status === 'pending' ? 'Nothing waiting for review.' : 'No gems here yet.'}</Empty> : (
          <div className={loading ? 'loading' : ''}>
            {data.rows.map(g => (
              <article className="enq" key={g.id}>
                <div className="enq-top">
                  <strong>{g.place}, {g.state} <span className={'pill ' + STATUS[g.status][1]}>{STATUS[g.status][0]}</span></strong>
                  <div className="row-actions">
                    {g.status !== 'approved' && <button className="btn primary sm" type="button" disabled={busy === g.id} onClick={() => act(g.id, 'approved')}>Approve</button>}
                    {g.status !== 'rejected' && <button className="btn ghost sm" type="button" disabled={busy === g.id} onClick={() => act(g.id, 'rejected')}>{g.status === 'approved' ? 'Take down' : 'Reject'}</button>}
                    {g.status !== 'pending' && <button className="btn ghost sm" type="button" disabled={busy === g.id} onClick={() => act(g.id, 'pending')}>Back to waiting</button>}
                    <button className="btn ghost sm" type="button" disabled={busy === g.id} onClick={() => act(g.id, 'delete')}>Delete</button>
                  </div>
                </div>
                <p className="enq-msg">{g.story}</p>
                <div className="enq-meta">
                  <span>{dateTime(g.created_at)}</span>
                  {g.best_months && <span>Best: {g.best_months}</span>}
                  <span>By {g.author || 'no name given'}</span>
                  {g.email && <a href={`mailto:${encodeURIComponent(g.email)}?subject=${encodeURIComponent('Your hidden gem: ' + g.place)}`}>{g.email}</a>}
                  <span>From {place(g.city, g.country)}</span>
                  {g.status === 'approved' && <span>{n(g.votes)} want to go</span>}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Season reminders, per place (shown in the Places tab) ---------- */
export function Reminders() {
  const { data, error, reload } = useApi('/admin/reminders');
  if (!data) return error ? <Failed error={error} onRetry={reload} /> : null;
  const state = r => (r.stopped_at ? ['Stopped', 'muted'] : r.confirmed_at ? ['On', 'ok'] : ['Not confirmed', 'warn']);
  return (
    <div className="grid two" style={{ marginTop: 16 }}>
      <Card title="Season reminders" aside="Emailed as each place’s best months begin">
        <HBars rows={data.byPlace.filter(r => r.active).map(r => ({ label: placeName(r.slug), n: r.active }))} empty="No reminders switched on yet." />
        {data.byPlace.length > 0 && (
          <details className="table-toggle">
            <summary>Details</summary>
            <div className="table-wrap">
              <table style={{ minWidth: 480 }}>
                <thead><tr><th>Place</th><th className="num">On</th><th className="num">Not confirmed</th><th className="num">Stopped</th><th>Last sent</th></tr></thead>
                <tbody>
                  {data.byPlace.map(r => (
                    <tr key={r.slug}><td>{placeName(r.slug)}<small>{placeState(r.slug)}</small></td><td className="num">{n(r.active)}</td><td className="num">{n(r.waiting)}</td><td className="num">{n(r.stopped)}</td><td>{r.last_sent ? ago(r.last_sent) : '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </Card>
      <Card title="Latest reminder sign-ups" flush>
        {data.recent.length ? (
          <ul className="qlist">
            {data.recent.slice(0, 12).map((r, i) => (
              <li className="q" key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span><strong>{placeName(r.slug)}</strong> · {r.email}</span>
                  <span className={'pill ' + state(r)[1]}>{state(r)[0]}</span>
                </div>
                <div className="q-meta"><span>{ago(r.created_at)}</span>{r.last_sent_at && <span>Last emailed {ago(r.last_sent_at)}</span>}</div>
              </li>
            ))}
          </ul>
        ) : <p className="empty">No sign-ups yet.</p>}
      </Card>
    </div>
  );
}
