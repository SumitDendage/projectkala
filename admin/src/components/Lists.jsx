import { useState } from 'react';
import { api, errorText } from '../api.js';
import { Card, Empty, Failed, HBars, Pager, Search, useApi } from './ui.jsx';
import { ago, date, dateTime, device, n, place, placeName, placeState, plain } from '../format.js';
import { Reminders } from './Features.jsx';

const query = (params) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null && v !== false));
  return q.toString() ? '?' + q : '';
};

/* ---------- Visitors ---------- */
export function Visitors({ onOpenVisitor }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [bots, setBots] = useState(false);
  const { data, error, loading, reload } = useApi('/admin/visitors' + query({ search, page, bots: bots ? '1' : '' }));
  return (
    <div>
      <div className="head">
        <div><h2>Visitors</h2><p>Every browser that opened the site, newest activity first. Select one to see its visits, questions and places.</p></div>
        <div className="tools">
          <Search value={search} onChange={v => { setSearch(v); setPage(1); }} label="Search place, device or name" />
          <label className="check"><input type="checkbox" checked={bots} onChange={e => { setBots(e.target.checked); setPage(1); }} /> Include bots</label>
        </div>
      </div>
      <Card flush>
        {!data ? (error ? <Failed error={error} onRetry={reload} /> : <Empty>Loading…</Empty>) : data.rows.length === 0 ? <Empty>No visitors match.</Empty> : (
          <div className={loading ? 'loading' : ''}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Last seen</th><th>Location</th><th>Device</th><th className="num">Visits</th><th className="num">Questions</th><th className="num">Places viewed</th><th>Account</th></tr></thead>
                <tbody>
                  {data.rows.map(v => (
                    <tr key={v.id} className="click" tabIndex={0} onClick={() => onOpenVisitor(v.id)} onKeyDown={e => { if (e.key === 'Enter') onOpenVisitor(v.id); }}>
                      <td>{ago(v.last_seen)}<small>since {date(v.first_seen)}</small></td>
                      <td>{place(v.city, v.country)}</td>
                      <td>{device(v)}</td>
                      <td className="num">{n(v.visit_count)}</td>
                      <td className="num">{n(v.questions)}</td>
                      <td className="num">{n(v.place_views)}</td>
                      <td>{v.user_email ? <>{v.user_name}<small>{v.user_email}</small></> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Accounts ---------- */
export function Accounts({ onOpenVisitor }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi('/admin/users' + query({ search, page }));
  return (
    <div>
      <div className="head">
        <div><h2>Accounts</h2><p>People who created an account. Select one to see their activity.</p></div>
        <Search value={search} onChange={v => { setSearch(v); setPage(1); }} label="Search name or email" />
      </div>
      <Card flush>
        {!data ? (error ? <Failed error={error} onRetry={reload} /> : <Empty>Loading…</Empty>) : data.rows.length === 0 ? <Empty>No accounts yet.</Empty> : (
          <div className={loading ? 'loading' : ''}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Joined</th><th>Last sign-in</th><th className="num">Saved places</th><th className="num">Questions</th></tr></thead>
                <tbody>
                  {data.rows.map(u => {
                    const open = () => u.visitor_id && onOpenVisitor(u.visitor_id);
                    return (
                      <tr key={u.id} className={u.visitor_id ? 'click' : ''} tabIndex={u.visitor_id ? 0 : undefined} onClick={open} onKeyDown={e => { if (e.key === 'Enter') open(); }}>
                        <td>{u.name} {u.is_admin && <span className="pill accent">Admin</span>}</td>
                        <td>{u.email}<small>{u.email_verified_at ? <span className="pill ok">Confirmed</span> : <span className="pill warn">Not confirmed</span>}</small></td>
                        <td>{date(u.created_at)}</td>
                        <td>{ago(u.last_login_at)}</td>
                        <td className="num">{n(u.saved)}</td>
                        <td className="num">{n(u.questions)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Questions asked to the AI consultant ---------- */
export function Questions({ onOpenChat, onOpenVisitor }) {
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useApi('/admin/questions' + query({ search, page }));
  return (
    <div>
      <div className="head">
        <div><h2>Questions</h2><p>What visitors searched for: every question asked to the AI consultant, newest first, with the start of its answer.</p></div>
        <Search value={search} onChange={v => { setSearch(v); setPage(1); }} label="Search questions" />
      </div>
      <Card flush>
        {!data ? (error ? <Failed error={error} onRetry={reload} /> : <Empty>Loading…</Empty>) : data.rows.length === 0 ? <Empty>No questions match.</Empty> : (
          <div className={loading ? 'loading' : ''}>
            <ul className="qlist">
              {data.rows.map(q => (
                <li className="q" key={q.id}>
                  <p className="q-text">{q.text}</p>
                  <div className="q-meta">
                    <span>{dateTime(q.created_at)}</span><span>{place(q.city, q.country)}</span><span>{q.device || ''}</span>
                    <span>{q.user_name ? `${q.user_name} (${q.user_email})` : 'Anonymous visitor'}</span>
                  </div>
                  {q.answer && <p className={'q-answer' + (open === q.id ? ' open' : '')}>{plain(q.answer)}</p>}
                  <div className="q-actions">
                    {q.answer && <button className="link" type="button" onClick={() => setOpen(open === q.id ? null : q.id)}>{open === q.id ? 'Show less' : 'Show more of the answer'}</button>}
                    <button className="link" type="button" onClick={() => onOpenChat(q.chat_id)}>Whole conversation</button>
                    <button className="link" type="button" onClick={() => onOpenVisitor(q.visitor_id)}>Visitor</button>
                  </div>
                </li>
              ))}
            </ul>
            <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />
          </div>
        )}
      </Card>
    </div>
  );
}

/* ---------- Places viewed and saved ---------- */
const ACTION = { view: 'viewed', save: 'saved', unsave: 'removed' };
export function Places({ onOpenVisitor }) {
  const { data, error, loading, reload } = useApi('/admin/places');
  const rows = data ? [...data.places].sort((a, b) => b.views - a.views) : [];
  return (
    <div className={loading && data ? 'loading' : ''}>
      <div className="head">
        <div><h2>Places</h2><p>Which places in the 3D ring visitors look at (a view counts after 1.5 seconds in front) and save.</p></div>
        <button className="btn ghost sm" type="button" onClick={reload}>Refresh</button>
      </div>
      {!data ? (error ? <Failed error={error} onRetry={reload} /> : <p className="muted">Loading…</p>) : (
        <div className="grid wide">
          <Card title="Views by place" aside="All time">
            <HBars rows={rows.map(p => ({ label: placeName(p.slug), n: p.views }))} empty="No place views yet." />
            {rows.length > 0 && (
              <details className="table-toggle" open>
                <summary>Details</summary>
                <div className="table-wrap">
                  <table style={{ minWidth: 560 }}>
                    <thead><tr><th>Place</th><th className="num">Views</th><th className="num">Visitors</th><th className="num">Saved now</th><th className="num">Saves</th><th className="num">Removed</th><th>Last viewed</th></tr></thead>
                    <tbody>
                      {rows.map(p => (
                        <tr key={p.slug}>
                          <td>{placeName(p.slug)}<small>{placeState(p.slug)}</small></td>
                          <td className="num">{n(p.views)}</td><td className="num">{n(p.viewers)}</td><td className="num">{n(p.saved_now)}</td>
                          <td className="num">{n(p.saves)}</td><td className="num">{n(p.unsaves)}</td><td>{ago(p.last_viewed)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
          </Card>
          <Card title="Latest activity" flush>
            {data.recent.length ? (
              <ul className="qlist">
                {data.recent.map((e, i) => (
                  <li className="q" key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span><strong>{placeName(e.slug)}</strong> {ACTION[e.action]}</span><span className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(e.created_at)}</span>
                    </div>
                    <div className="q-meta"><span>{e.user_name || 'Anonymous visitor'}</span><span>{place(e.city, e.country)}</span>
                      <button className="link" type="button" style={{ fontSize: 12.5 }} onClick={() => onOpenVisitor(e.visitor_id)}>Visitor</button></div>
                  </li>
                ))}
              </ul>
            ) : <p className="empty">No activity yet.</p>}
          </Card>
        </div>
      )}
      {data && <Reminders />}
    </div>
  );
}

/* ---------- Trip enquiries ---------- */
export function Enquiries({ onChanged }) {
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(null), [msg, setMsg] = useState('');
  const { data, error, loading, reload } = useApi('/admin/enquiries' + query({ status }));
  async function change(id, value) {
    setSaving(id); setMsg('');
    try { await api('/admin/enquiries/' + id, { method: 'PATCH', body: { status: value } }); reload(); onChanged && onChanged(); }
    catch (e) { setMsg(errorText(e)); }
    finally { setSaving(null); }
  }
  return (
    <div>
      <div className="head">
        <div><h2>Enquiries</h2><p>Trip enquiries sent from the form at the bottom of the site. Reply by email, then mark them contacted or closed.</p></div>
        <label className="tools"><span className="sr">Show</span>
          <select className="input" value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All enquiries</option><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
          </select>
        </label>
      </div>
      {msg && <p className="note err" role="alert">{msg}</p>}
      <Card flush>
        {!data ? (error ? <Failed error={error} onRetry={reload} /> : <Empty>Loading…</Empty>) : data.rows.length === 0 ? <Empty>No enquiries{status ? ` marked ${status}` : ' yet'}.</Empty> : (
          <div className={loading ? 'loading' : ''}>
            {data.rows.map(e => (
              <article className="enq" key={e.id}>
                <div className="enq-top">
                  <strong>{e.name} · <a href={`mailto:${encodeURIComponent(e.email)}?subject=${encodeURIComponent('Your trip enquiry')}`}>{e.email}</a></strong>
                  <label><span className="sr">Status for {e.name}</span>
                    <select className="input" value={e.status} disabled={saving === e.id} onChange={x => change(e.id, x.target.value)}>
                      <option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option>
                    </select>
                  </label>
                </div>
                <p className="enq-msg">{e.message}</p>
                <div className="enq-meta">
                  <span>{dateTime(e.created_at)}</span>
                  {e.place && <span>Place: {e.place}</span>}{e.dates && <span>When: {e.dates}</span>}
                  {e.travellers && <span>Travellers: {e.travellers}</span>}<span>From {place(e.city, e.country)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
