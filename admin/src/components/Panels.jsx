import { useState } from 'react';
import { Card, Failed, Panel, useApi } from './ui.jsx';
import { ago, dateTime, device, n, place, placeName, plain } from '../format.js';

const ACTION = { view: 'Viewed', save: 'Saved', unsave: 'Removed from saved' };

function Conversation({ messages }) {
  return (
    <div className="msgs">
      {messages.map((m, i) => <div key={i} className={'msg ' + m.role}>{m.role === 'assistant' ? plain(m.text) : m.text}</div>)}
    </div>
  );
}

/* Everything about one visitor: who, where from, every visit, every question, every place. */
export function VisitorPanel({ id, onClose }) {
  const { data, error, reload } = useApi('/admin/visitors/' + encodeURIComponent(id));
  const [open, setOpen] = useState(null);
  const v = data && data.visitor;
  return (
    <Panel title={v ? (v.user_name || 'Visitor') : 'Visitor'} onClose={onClose}>
      {!data ? (error ? <Failed error={error} onRetry={reload} /> : <p className="muted">Loading…</p>) : (
        <>
          <Card title="Details">
            <dl className="kv">
              <dt>Account</dt><dd>{v.user_email ? <>{v.user_name} · <a href={'mailto:' + encodeURIComponent(v.user_email)}>{v.user_email}</a> {v.email_verified_at ? <span className="pill ok">Confirmed</span> : <span className="pill warn">Not confirmed</span>}</> : <span className="muted">No account (anonymous visitor)</span>}</dd>
              <dt>Location</dt><dd>{place(v.city, v.region, v.country)}</dd>
              <dt>Device</dt><dd>{device(v)}</dd>
              <dt>First visit</dt><dd>{dateTime(v.first_seen)}</dd>
              <dt>Last seen</dt><dd>{dateTime(v.last_seen)} ({ago(v.last_seen)})</dd>
              <dt>Visits</dt><dd>{n(v.visit_count)}</dd>
              {data.saved.length > 0 && <><dt>Saved places</dt><dd>{data.saved.map(s => placeName(s.slug)).join(', ')}</dd></>}
            </dl>
          </Card>
          <Card title="Questions asked" aside={`${data.chats.reduce((t, c) => t + c.messages.filter(m => m.role === 'user').length, 0)} questions`}>
            {data.chats.length ? (
              <ul className="timeline">
                {data.chats.map(c => (
                  <li key={c.id} style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <strong>{c.title}</strong><span className="muted" style={{ whiteSpace: 'nowrap' }}>{ago(c.updated_at)}</span>
                    </div>
                    <button className="link" type="button" style={{ fontSize: 13, marginTop: 4 }} onClick={() => setOpen(open === c.id ? null : c.id)}>
                      {open === c.id ? 'Hide conversation' : `Show conversation (${c.messages.length} messages)`}
                    </button>
                    {open === c.id && <div style={{ marginTop: 10 }}><Conversation messages={c.messages} /></div>}
                  </li>
                ))}
              </ul>
            ) : <p className="muted" style={{ margin: 0 }}>No questions yet.</p>}
          </Card>
          <Card title="Places" aside={`${data.places.length} events`}>
            {data.places.length ? (
              <ul className="timeline">
                {data.places.map((p, i) => <li key={i}><span>{ACTION[p.action]} <strong>{placeName(p.slug)}</strong></span><span className="muted">{ago(p.created_at)}</span></li>)}
              </ul>
            ) : <p className="muted" style={{ margin: 0 }}>No places viewed yet.</p>}
          </Card>
          <Card title="Visits" aside={`${data.visits.length} shown`}>
            <ul className="timeline">
              {data.visits.map((x, i) => (
                <li key={i}>
                  <span>{dateTime(x.created_at)}<small className="muted" style={{ display: 'block' }}>{place(x.city, x.country)} · {device(x)}{x.referrer ? ` · from ${x.referrer}` : ''}</small></span>
                  <span className="muted">{x.language || ''}</span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </Panel>
  );
}

export function ChatPanel({ id, onClose }) {
  const { data, error, reload } = useApi('/admin/chats/' + encodeURIComponent(id));
  return (
    <Panel title={data ? data.chat.title : 'Conversation'} onClose={onClose}>
      {!data ? (error ? <Failed error={error} onRetry={reload} /> : <p className="muted">Loading…</p>) : (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {dateTime(data.chat.created_at)} · {place(data.chat.city, data.chat.country)}{data.chat.user_name ? ` · ${data.chat.user_name}` : ' · anonymous visitor'}
          </p>
          <Conversation messages={data.messages} />
        </>
      )}
    </Panel>
  );
}
