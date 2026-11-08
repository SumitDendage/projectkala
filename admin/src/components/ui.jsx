import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api.js';
import { dayLabel, n, nc } from '../format.js';

/* Load data from the API; keeps the last result on screen while reloading. */
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState(s => ({ ...s, loading: true }));
    api(path).then(
      data => live && setState({ data, error: null, loading: false }),
      error => live && setState(s => ({ data: s.data, error, loading: false }))
    );
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { ...state, reload };
}

export function Failed({ error, onRetry }) {
  return (
    <div className="empty">
      <p>{errorText(error)}</p>
      {onRetry && <button className="btn ghost sm" type="button" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function StatTile({ label, value, sub }) {
  return (
    <div className="card stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{nc(value)}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function Card({ title, aside, children, flush }) {
  return (
    <section className="card">
      {(title || aside) && <div className="card-h"><h3>{title}</h3>{aside && <small>{aside}</small>}</div>}
      {flush ? children : <div className="card-b">{children}</div>}
    </section>
  );
}

// Round an axis maximum up to 1, 2 or 5 × a power of ten.
function niceMax(v) {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map(m => m * p).find(m => m >= v);
}

/* Visits per day: one series, columns from one baseline, value on the tallest and the latest
   column, tooltip on hover and keyboard focus, and a table view of every value. */
export function ColumnChart({ rows, label = 'Visits' }) {
  const [hover, setHover] = useState(-1);
  const W = 720, H = 210, top = 22, bottom = 28, left = 34;
  const plotH = H - top - bottom, plotW = W - left;
  const max = niceMax(Math.max(0, ...rows.map(r => r.visits)));
  const band = plotW / rows.length, bw = Math.min(24, band * 0.62);
  const y = v => top + plotH - (v / max) * plotH;
  const peak = rows.reduce((best, r, i) => (r.visits > rows[best].visits ? i : best), 0);
  const show = new Set([peak, rows.length - 1].filter(i => rows[i] && rows[i].visits > 0));
  const ticks = [0, max / 2, max];
  const col = (x, v) => {
    const h = Math.max(0, (v / max) * plotH), yy = top + plotH - h, r = Math.min(4, h, bw / 2);
    if (h <= 0) return '';
    return `M${x},${top + plotH}V${yy + r}Q${x},${yy} ${x + r},${yy}H${x + bw - r}Q${x + bw},${yy} ${x + bw},${yy + r}V${top + plotH}Z`;
  };
  const cur = rows[hover];
  return (
    <div className={'chart' + (hover >= 0 ? ' hovering' : '')}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} per day, last ${rows.length} days. Peak ${n(rows[peak].visits)} on ${dayLabel(rows[peak].day)}.`}>
        {ticks.map(t => (
          <g key={t}>
            <line className="grid-line" x1={left} x2={W} y1={y(t)} y2={y(t)} />
            <text className="axis-text" x={left - 8} y={y(t) + 4} textAnchor="end">{nc(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const x = left + i * band + (band - bw) / 2;
          return (
            <g key={r.day}>
              <path className={'col' + (i === hover ? ' on' : '')} d={col(x, r.visits)} />
              {show.has(i) && <text className="value-text" x={x + bw / 2} y={y(r.visits) - 7} textAnchor="middle">{n(r.visits)}</text>}
              {(i % 2 === rows.length % 2 || i === rows.length - 1) && <text className="axis-text" x={x + bw / 2} y={H - 8} textAnchor="middle">{dayLabel(r.day)}</text>}
              <rect className="hit" x={left + i * band} y={top} width={band} height={plotH} tabIndex={0}
                aria-label={`${dayLabel(r.day)}: ${n(r.visits)} ${label.toLowerCase()}`}
                onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(-1)}
                onFocus={() => setHover(i)} onBlur={() => setHover(-1)} />
            </g>
          );
        })}
      </svg>
      {cur && (
        <div className="tip" style={{ left: `${((left + hover * band + band / 2) / W) * 100}%`, top: `${(y(cur.visits) / H) * 100}%` }}>
          <strong>{n(cur.visits)}</strong>{label.toLowerCase()} · {dayLabel(cur.day)}
        </div>
      )}
      <details className="table-toggle">
        <summary>Show as a table</summary>
        <div className="table-wrap">
          <table style={{ minWidth: 0 }}>
            <thead><tr><th>Day</th><th className="num">{label}</th></tr></thead>
            <tbody>{rows.map(r => <tr key={r.day}><td>{dayLabel(r.day)}</td><td className="num">{n(r.visits)}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* Ranked magnitudes with the value printed at the end of each bar. */
export function HBars({ rows, empty = 'Nothing yet.' }) {
  if (!rows.length) return <p className="muted" style={{ margin: 0 }}>{empty}</p>;
  const max = Math.max(1, ...rows.map(r => r.n));
  return (
    <ul className="hbars">
      {rows.map(r => (
        <li className="hbar" key={r.label}>
          <span className="hbar-label" title={r.label}>{r.label}</span>
          <span className="hbar-track" aria-hidden="true"><span className="hbar-fill" style={{ width: `${(r.n / max) * 100}%` }} /></span>
          <span className="hbar-value">{n(r.n)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span>{n(from)}–{n(to)} of {n(total)}</span>
      <span className="tools">
        <button className="btn ghost sm" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <button className="btn ghost sm" type="button" disabled={to >= total} onClick={() => onPage(page + 1)}>Next</button>
      </span>
    </div>
  );
}

/* Search box that waits until typing pauses. */
export function Search({ value, onChange, label }) {
  const [text, setText] = useState(value);
  const t = useRef(0);
  useEffect(() => setText(value), [value]);
  return (
    <label className="tools">
      <span className="sr">{label}</span>
      <input className="input" type="search" placeholder={label} value={text}
        onChange={e => { const v = e.target.value; setText(v); clearTimeout(t.current); t.current = setTimeout(() => onChange(v.trim()), 300); }} />
    </label>
  );
}

/* A side panel with its own close button; Escape and the backdrop close it too. */
export function Panel({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const last = document.activeElement;
    ref.current && ref.current.focus();
    const key = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; if (last && last.focus) last.focus(); };
  }, [onClose]);
  return (
    <div className="panel" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel-in" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose}>Close</button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </div>
  );
}
