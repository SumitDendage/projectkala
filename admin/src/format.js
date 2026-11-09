// Places in the 3D ring (keep in step with the PLACES list in src/page.html).
export const PLACES = {
  jaisalmer: ['Jaisalmer', 'Rajasthan'],
  manali: ['Manali', 'Himachal Pradesh'],
  alleppey: ['Alleppey', 'Kerala'],
  munnar: ['Munnar', 'Kerala'],
  tawang: ['Tawang', 'Arunachal Pradesh'],
  dehradun: ['Dehradun', 'Uttarakhand'],
  'spiti-valley': ['Spiti Valley', 'Himachal Pradesh'],
  meghalaya: ['Meghalaya', 'Meghalaya'],
  'robbers-cave': ['Robber’s Cave', 'Uttarakhand']
};
export const placeName = slug => (PLACES[slug] ? PLACES[slug][0] : slug);
export const placeState = slug => (PLACES[slug] ? PLACES[slug][1] : '');

const num = new Intl.NumberFormat('en-IN');
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
export const n = v => num.format(v || 0);
export const nc = v => (Math.abs(v || 0) >= 10000 ? compact.format(v) : num.format(v || 0));

export const dateTime = t => (t ? new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
export const date = t => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dayLabel = iso => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function ago(t) {
  if (!t) return '—';
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return date(t);
}

// AI answers are Markdown; show them as plain readable text. The ```places block at the end (photos and
// maps on the site) is left out.
export const plain = s => String(s || '')
  .replace(/\n*```places[\s\S]*?(?:```|$)/g, '')
  .replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, '$1')
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/(\*\*|__)(.+?)\1/g, '$2')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
  .replace(/`([^`]+)`/g, '$1')
  .replace(/^\s*[-*]\s+/gm, '• ');

export const place = (...parts) => parts.filter(Boolean).join(', ') || 'Unknown';
export const device = r => [r.device, r.browser, r.os].filter(x => x && x !== 'Other').join(' · ') || 'Unknown';
