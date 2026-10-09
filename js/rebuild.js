/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Recovery & growth: muscle recovery, hormones and protein as
   one model (logic/rebuild.ts). The Body Systems row opens this sheet: the
   rebuild index with its range, the three parts and what each rests on, the
   muscle rebuilding right now, and whether your own lifts agree.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, esc, icon, today, fmt1, openSheet } from './core.js';
import { GROUPS } from './views.js';

let cache = null, cacheKey = null;
/** The model for the phone's view of your data (cached per data version and hour). */
export function rebuildNow(v = view()) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + today() + ':' + new Date().getHours();
  if (cacheKey === k) return cache;
  const p = v.profile || {}, wk = Object.keys(v.weights || {}).sort().pop(), w = wk ? v.weights[wk] : (+p.weight || null);
  const sp = L.specimen(Object.assign({}, p, w ? { weight: w } : {}));
  const career = v.career || { logged: (v.workouts || []).length, prior: 0 };
  cache = L.rebuildModel({ now: Date.now(), today: today(), bio: v.bio || {}, weights: v.weights || {}, weight: w, tdee: sp.tdee || null, age: sp.age,
    protGoal: ((v.bioDefs || {}).goals || {}).prot || null, sessions: v.workouts || [], logged: (career.logged || 0) + (career.prior || 0), endo: v.endo || null });
  cacheKey = k; return cache;
}

const GRADE = { good: ['#30d158', 'Good'], watch: ['#ffd60a', 'Watch'], poor: ['#ff453a', 'Needs work'] };
const ICON = { protein: '🥩', sleep: '🌙', hormones: '⚗️', energy: '⚡' };
const SOURCES = [
  ['MacDougall 1995', 'Can J Appl Physiol', 'protein synthesis +109 % at 24 h after training, near baseline by 36 h'],
  ['Phillips 1997', 'Am J Physiol', 'untrained: still +34 % at 48 h'],
  ['Morton 2018', 'Br J Sports Med', '49 trials: gains rise with protein to ~1.62 g/kg a day, then plateau'],
  ['Moore 2015', 'J Gerontol', 'one meal maxes synthesis at ~0.24 g/kg young, ~0.40 g/kg older'],
  ['Schoenfeld 2013', 'J Int Soc Sports Nutr', 'timing matters little once the daily total is met'],
  ['Trommelen 2023', 'Cell Rep Med', 'no upper limit to one large protein meal'],
  ['Snijders 2015', 'J Nutr', 'protein before sleep added strength and size over 12 weeks'],
  ['Lamon 2021', 'Physiol Rep', 'one night without sleep: synthesis −18 %, testosterone −24 %, cortisol +21 %'],
  ['Saner 2020', 'J Physiol', '5 nights of 4 h: myofibrillar synthesis −19 %'],
  ['Leproult 2011', 'JAMA', 'a week of 5 h nights: daytime testosterone −10–15 %'],
  ['Morton 2016', 'J Appl Physiol', 'hormone rises after training do not predict muscle or strength gained'],
  ['West & Phillips 2012', 'Eur J Appl Physiol', 'the same, in 56 young men'],
  ['Bhasin 2001', 'Am J Physiol', 'across a wide testosterone range, lean mass follows the dose'],
  ['Areta 2014', 'Am J Physiol', '~33 % energy deficit: resting synthesis −27 %; training + protein restore it'],
  ['Pasiakos 2013', 'FASEB J', '1.6–2.4 g/kg protected muscle during a 40 % deficit'],
  ['Pasiakos 2014', 'Sports Med', 'protein does not measurably speed recovery of muscle function'],
];

function factorRow(f) {
  const e = Math.round(-f.effect * 100), w = Math.min(100, e * 2.5);
  return `<div class="rb-f${f.known ? '' : ' off'}"><span class="rb-ic">${ICON[f.key]}</span>
    <div class="rb-ft"><div class="rb-fn"><b>${esc(f.name)}</b><span class="num ${e > 0 ? 'neg' : ''}">${f.known ? (e > 0 ? '−' + e + ' %' : 'no brake') : 'not counted'}</span></div>
      <div class="sub">${esc(f.value)}</div>
      ${f.known ? `<div class="rb-bar"><i style="width:${w}%"></i></div>` : ''}
      <div class="rb-note">${esc(f.note)}</div><div class="rb-src">${esc(f.source)}</div></div></div>`;
}
function windowRow(W, R) {
  const g = W.groups.map(k => (GROUPS[k] || [k])[0]).join(' · ') || 'Workout';
  return `<div class="rb-w"><div class="rb-wt"><b>${esc(g)}</b><span class="sub">${W.hoursAgo} h ago${W.timed ? '' : ' · time not logged'}</span></div>
    <div class="rb-bar w"><i style="width:${Math.round(W.leftH / R.windowH * 100)}%"></i></div>
    <div class="sub">${W.leftH ? '~' + W.leftH + ' h of the ' + R.windowH + ' h window left' + (W.elevation < 1 ? ' · synthesis already falling' : ' · synthesis near its peak') : 'window closing'}</div>
    ${W.protein && W.protein.need >= 5 ? `<div class="sub">Protein since: <b class="num">${W.protein.eaten} g</b> of ~${W.protein.need} g for these hours</div>` : ''}</div>`;
}
export function rebuildSheet() {
  openSheet({
    id: 'rebuild', title: 'Recovery & growth',
    render: () => {
      const R = rebuildNow(), g = R.grade ? GRADE[R.grade] : ['var(--t4)', 'Not measured'];
      const hero = R.known
        ? `<section class="card frost rb-hero"><div class="rb-n num" style="color:${g[0]}">${R.index}<small>%</small></div>
            <div><span class="sys-g" style="--g:${g[0]}">${g[1]}</span><div class="sub" style="margin-top:4px">likely ${R.low}–${R.high} %</div>
            <div class="rb-what">How much of what your training asks for is being built — 100 % is where the research sees no further gain.</div></div></section>
          ${R.limiting ? `<div class="target hint">${icon('bolt', 16)}<div><b>Biggest lever</b><span>${esc(R.limiting.text)}</span></div></div>` : `<div class="target hint">${icon('tick', 16)}<div><b>Nothing is holding it back</b><span>Protein, sleep and energy are where the research sees no further gain.</span></div></div>`}`
        : `<section class="card frost"><div class="empty" style="padding:6px">${esc(R.why)}</div></section>`;
      const fs = R.factors, by = k => fs.find(f => f.key === k);
      const chain = `<p class="sub rb-chain">Training opens a window in which muscle builds faster. <b>Protein</b> is what it builds with; <b>sleep and hormones</b> set the pace — sleep acts largely through them, so only the larger brake counts; an <b>energy deficit</b> slows it, and protein shields most of that.</p>`;
      const parts = `<div class="grp-h">The three, connected</div>${chain}
        <section class="card frost tight">${factorRow(by('protein'))}</section>
        <section class="card frost tight rb-path"><div class="rb-pathh">One pathway — the larger brake counts</div>${factorRow(by('sleep'))}${factorRow(by('hormones'))}</section>
        <section class="card frost tight">${factorRow(by('energy'))}</section>`;
      const wins = `<div class="grp-h">Rebuilding now</div>${R.windows.length ? `<section class="card frost tight">${R.windows.map(W => windowRow(W, R)).join('')}</section>`
        : `<section class="card frost tight"><div class="sub" style="padding:4px 2px;line-height:1.45">No session in the last ${R.windowH} h. The ${R.known ? 'index' : 'model'} shows how well the next one would be rebuilt.</div></section>`}
        <p class="sub" style="line-height:1.45;margin:6px 2px 0">${R.trained ? 'Trained: synthesis stays raised ~36 h.' : 'Newer to training: synthesis stays raised ~48 h.'} Soreness is not scored — protein does not measurably speed how fast strength comes back.</p>`;
      const meal = R.perMeal ? `<div class="grp-h">Per meal</div><section class="card frost tight"><div class="sub" style="padding:4px 2px;line-height:1.45">Portions of <b>~${R.perMeal.dose} g</b> protein (${R.perMeal.perKg} g/kg) max out one meal's response — ${R.perMeal.perDay != null ? 'you reach it <b>' + fmt1(R.perMeal.perDay) + '</b> times a day.' : 'log meals to see how often you reach it.'} The daily total matters more than timing; a portion before bed adds a little.</div></section>` : '';
      const own = `<div class="grp-h">In your own lifts</div><section class="card frost tight"><div class="sub" style="padding:4px 2px;line-height:1.45">${esc(R.personal.text)}</div>
        ${R.personal.protein == null && R.personal.sleep == null ? `<div class="rb-bar w" style="margin:8px 2px 4px"><i style="width:${Math.min(100, Math.round(R.personal.n / R.personal.need * 100))}%"></i></div>` : ''}</section>`;
      const src = `<div class="grp-h">What it rests on</div><section class="card frost tight rb-srcs">${SOURCES.map(s => `<div><b>${esc(s[0])}</b> <i>${esc(s[1])}</i><span>${esc(s[2])}</span></div>`).join('')}</section>
        <p class="sub" style="line-height:1.45;margin:8px 2px 0">An estimate from published effect sizes and your logs — the range says how sure it is. Hormones are ARK's estimate, not blood.</p>`;
      return hero + parts + wins + meal + own + src;
    },
  });
}
export const actions = { 'rebuild-sheet'() { rebuildSheet(); } };
