/* The places in the site's 3D ring, as the backend needs them: for season reminders and Gem Finder.
   Keep this in step with PLACES in src/page.html (same slugs, names and best months). */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = MONTHS.map(m => m.slice(0, 3));

const PLACES = [
  { slug: 'jaisalmer', name: 'Jaisalmer', state: 'Rajasthan', best: 'Oct–Mar' },
  { slug: 'manali', name: 'Manali', state: 'Himachal Pradesh', best: 'Apr–Jun, Sep–Nov' },
  { slug: 'alleppey', name: 'Alleppey', state: 'Kerala', best: 'Oct–Mar' },
  { slug: 'munnar', name: 'Munnar', state: 'Kerala', best: 'Sep–Mar' },
  { slug: 'tawang', name: 'Tawang', state: 'Arunachal Pradesh', best: 'Mar–Jun, Sep–Oct' },
  { slug: 'dehradun', name: 'Dehradun', state: 'Uttarakhand', best: 'Oct–Apr' },
  { slug: 'spiti-valley', name: 'Spiti Valley', state: 'Himachal Pradesh', best: 'Jun–Oct' },
  { slug: 'meghalaya', name: 'Meghalaya', state: 'Meghalaya', best: 'Oct–Apr' },
  { slug: 'robbers-cave', name: 'Robber’s Cave', state: 'Uttarakhand', best: 'Mar–Jun' }
];

// "Apr–Jun, Sep–Nov" → seasons [[4, 6], [9, 11]] (months 1–12; a season may wrap past December).
function seasons(best) {
  return best.split(',').map(part => {
    const [a, b] = part.trim().split('–').map(s => SHORT.indexOf(s.trim().slice(0, 3)) + 1);
    return [a, b || a];
  });
}
PLACES.forEach(p => {
  p.seasons = seasons(p.best);
  p.starts = p.seasons.map(s => s[0]);
});
const BY_SLUG = Object.fromEntries(PLACES.map(p => [p.slug, p]));

// The next month (1–12) a season starts, counting from `month` itself.
function nextStart(place, month) {
  for (let k = 0; k < 12; k++) {
    const m = ((month - 1 + k) % 12) + 1;
    if (place.starts.includes(m)) return m;
  }
  return place.starts[0];
}

const monthName = m => MONTHS[m - 1];

// Whether `month` falls in one of the place's best seasons.
const inSeason = (place, month) => place.seasons.some(([a, b]) => (a <= b ? month >= a && month <= b : month >= a || month <= b));

// India's 28 states and 8 union territories, for places travellers share.
const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
];

module.exports = { PLACES, BY_SLUG, MONTHS, STATES, nextStart, monthName, inSeason };
