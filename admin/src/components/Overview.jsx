import { Card, ColumnChart, Failed, HBars, StatTile, useApi } from './ui.jsx';
import { ago, n, place, placeName, placeState } from '../format.js';

export default function Overview({ status, onOpenTab }) {
  const { data, error, loading, reload } = useApi('/admin/overview');
  if (!data) return error ? <Failed error={error} onRetry={reload} /> : <p className="muted">Loading…</p>;
  const c = data.counts;
  return (
    <div className={loading ? 'loading' : ''}>
      <div className="head">
        <div>
          <h2>Overview</h2>
          <p>Who visits, what they ask the AI consultant, and which places they look at. Bots are left out.</p>
        </div>
        <button className="btn ghost sm" type="button" onClick={reload}>Refresh</button>
      </div>
      {status && !status.mail && (
        <div className="callout" role="status">
          <strong>Emails are off.</strong> Password reset and email confirmation need an email service. Add <code>BREVO_API_KEY</code> (and <code>MAIL_FROM</code>, a sender verified in Brevo) to your Node.js app’s environment variables on Hostinger, then restart the app.
        </div>
      )}
      <div className="stats">
        <StatTile label="Visitors" value={c.visitors} sub={`${n(c.visitors_7d)} in the last 7 days`} />
        <StatTile label="Visits, last 24 hours" value={c.visits_24h} />
        <StatTile label="Accounts" value={c.accounts} sub={`${n(c.verified)} confirmed · ${n(c.accounts_7d)} new this week`} />
        <StatTile label="Questions asked" value={c.questions} sub={`${n(c.questions_7d)} in the last 7 days`} />
        <StatTile label="Places saved" value={c.saved} />
        <StatTile label="New enquiries" value={c.new_enquiries} sub={c.new_enquiries ? 'Waiting for a reply' : 'All answered'} />
      </div>
      <div className="grid wide" style={{ marginBottom: 16 }}>
        <Card title="Visits per day" aside={`Last 14 days · ${status ? status.timezone : ''}`}>
          <ColumnChart rows={data.daily} label="Visits" />
        </Card>
        <div className="grid">
          <Card title="Where visitors are" aside="By country"><HBars rows={data.countries} empty="No visitors yet." /></Card>
          <Card title="Devices"><HBars rows={data.devices} empty="No visitors yet." /></Card>
        </div>
      </div>
      <div className="grid two">
        <Card title="Latest questions" aside={<button className="link" type="button" onClick={() => onOpenTab('questions')}>See all</button>} flush>
          {data.questions.length ? (
            <ul className="qlist">
              {data.questions.map((q, i) => (
                <li className="q" key={i}>
                  <p className="q-text">{q.text}</p>
                  <div className="q-meta"><span>{ago(q.created_at)}</span><span>{place(q.city, q.country)}</span>{q.user_name && <span>{q.user_name}</span>}</div>
                </li>
              ))}
            </ul>
          ) : <p className="empty">No questions yet.</p>}
        </Card>
        <Card title="Most viewed places" aside={<button className="link" type="button" onClick={() => onOpenTab('places')}>See all</button>} flush>
          {data.places.length ? (
            <div className="table-wrap">
              <table style={{ minWidth: 0 }}>
                <thead><tr><th>Place</th><th className="num">Views</th><th className="num">Saves</th></tr></thead>
                <tbody>
                  {data.places.map(p => (
                    <tr key={p.slug}><td>{placeName(p.slug)}<small>{placeState(p.slug)}</small></td><td className="num">{n(p.views)}</td><td className="num">{n(p.saves)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No place views yet.</p>}
        </Card>
      </div>
    </div>
  );
}
