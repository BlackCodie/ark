/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — hormones, by the day and by the hour.

   The PC's endocrine engine gives each axis a daily 0–100 state (from sleep,
   training, food, stress, light, doses… through its causal graph) and the last
   21 days of it. logic/hourly.ts puts the within-day shape around that: body
   clock rhythms and the timed events of today — training, caffeine, alcohol,
   sleep and light. logic/labs.ts translates each daily state into the units
   its blood test reports (ng/dL, µg/dL…) — an estimate, labelled as one.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, esc, icon, today, fmtDay, haptic, openSheet, topSheet } from './core.js';
import { bedtimeTonight } from './doses.js';

const H = 3600e3;
const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const HORMONE_INFO = {
  testosterone: ['Testosterone', 'The main androgen: muscle growth, drive, libido and bone. Most of it is made during sleep.'],
  freeTestosterone: ['Free testosterone', 'The share not bound to SHBG — the part your tissues can actually use.'],
  estradiol: ['Estradiol', 'Made from testosterone. Men need it too — for bones, libido and the brain — so both too low and too high are a problem: the middle band is the goal.'],
  cortisol: ['Cortisol', 'The wake-up and stress hormone. A strong morning peak and a low evening are healthy; high all day is not — the middle band is the goal.'],
  growthHormone: ['Growth hormone', 'Repair, recovery and fat use. Released in pulses, the biggest one in your first deep sleep.'],
  igf1: ['IGF-1', 'Made in the liver in answer to growth hormone and protein; drives muscle and tissue repair. It moves over weeks, not hours.'],
  insulinSensitivity: ['Insulin sensitivity', 'How easily your muscles take up sugar. Higher is better — training, sleep and fitness raise it.'],
  thyroid: ['Thyroid', 'Sets your metabolic rate, body temperature and energy.'],
  dopamineTone: ['Dopamine', 'Motivation and drive — the brain\'s "go" signal.'],
};

/* The engine names its internal states; these say what each one is made of. */
const PLAIN = {
  'circadian alignment': 'Body-clock alignment (regular sleep, morning light)',
  'recovery debt': 'Recovery debt (short sleep, heavy training)',
  'inflammation load': 'Inflammation (illness, alcohol, poor sleep)',
  'stress adaptation': 'Stress resilience',
  'anabolic drive': 'Building signal (training, protein, energy)',
  'catabolic pressure': 'Breakdown pressure (calorie deficit, overreaching)',
  'energy availability': 'Energy available (food vs what you burn)',
  'autonomic balance': 'Rest-and-recover balance (HRV)',
  'aromatase activity': 'Testosterone → estradiol conversion (body fat, alcohol)',
  'thyroid cofactor status': 'Thyroid nutrients (iodine, selenium, zinc)',
};
function plain(label) {
  const m = /^(High|Low) (.+)$/.exec(label || '');
  if (!m) return label;
  const base = PLAIN[m[2].toLowerCase()] || (m[2].charAt(0).toUpperCase() + m[2].slice(1));
  return base + ' — ' + m[1].toLowerCase();
}
export const statusText = s => s ? s.charAt(0) + s.slice(1).toLowerCase() : '';

/* ── inputs for the hourly layer, from the snapshot ── */
function clockToday(day0, h, prevEvening) {
  if (typeof h !== 'number') return null;
  return prevEvening && h > 12 ? day0 - (24 - h) * H : day0 + h * H;
}
let cache = null, cacheKey = '';
export function hormoneDay() {
  const v = view(), key = (v.rev || 0) + ':' + state.pending.length + ':' + Math.floor(Date.now() / 300e3);
  if (cache && cacheKey === key) return cache;
  const t = today(), b = v.bio[t] || {}, axes = (v.endo && v.endo.axes) || [];
  const d0 = new Date(); d0.setHours(0, 0, 0, 0); const day0 = d0.getTime();
  const wake = clockToday(day0, b.wake, false) ?? day0 + 7 * H;
  const sleepOnset = clockToday(day0, b.bed, true) ?? (b.sleep ? wake - b.sleep * H - 0.25 * H : day0 - 1 * H);
  const sessions = v.workouts.filter(w => w.ts).map(w => {
    const end = Date.parse(w.ts), dur = (w.duration || 3600) * 1000;
    const rpes = (w.exercises || []).flatMap(e => (e.sets || []).map(s => Number(s.rpe)).filter(x => x > 0));
    const intensity = rpes.length ? Math.max(0.3, Math.min(1, (rpes.reduce((a, x) => a + x, 0) / rpes.length - 5) / 5)) : 0.7;
    return { start: end - dur, end, intensity };
  }).filter(s => s.end >= day0 - 12 * H && s.start <= day0 + 24 * H);
  const beh = L.behaviourOn(t, v.habits, v.habitLog, v.dayRoutines || L.DEFAULT_DAY_ROUTINES, v.routineLog || {});
  const sp = L.specimen(v.profile || {}) || {};
  cache = { day0, axes, out: L.hormoneHours({
    day0, now: Date.now(), sleepOnset, wake, bedtime: bedtimeTonight(),
    scores: Object.fromEntries(axes.map(a => [a.k, a.score])), sessions, doses: v.doses || [],
    daylight: (b.daylight || 0) + beh.sunlight, stress: b.stress ?? null, age: sp.age ?? null, sex: (v.profile || {}).sex || 'male',
  }) };
  cacheKey = key;
  return cache;
}

/* ── charts ── */
function spark(pts, color) {
  if (!pts || pts.length < 2) return '';
  const W = 72, h = 24, x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  const X = t => (t - x0) / (x1 - x0) * W, Y = v => h - 2 - v / 100 * (h - 4);
  const now = Date.now();
  return `<svg class="hspark" viewBox="0 0 ${W} ${h}" aria-hidden="true"><path d="${pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${now > x0 && now < x1 ? `<circle cx="${X(now).toFixed(1)}" cy="${Y(pts[Math.round((now - x0) / (x1 - x0) * (pts.length - 1))].v).toFixed(1)}" r="2.4" fill="#fff"/>` : ''}</svg>`;
}
const EV_ICON = { wake: '☀️', sleep: '🌙', train: '🏋️', caffeine: '☕', alcohol: '🍺' };
function dayChart(k, D, color, band) {
  const pts = D.out.points[k]; if (!pts || !pts.length) return '';
  const W = 340, h = 150, top = 20, bot = 20, x0 = pts[0].t, x1 = pts[pts.length - 1].t, now = Date.now();
  const X = t => 6 + (t - x0) / (x1 - x0) * (W - 12), Y = v => top + (1 - v / 100) * (h - top - bot);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
  const ev = D.out.events;
  const sleep = [], wake = ev.find(e => e.kind === 'wake'), bed = ev.filter(e => e.kind === 'sleep').pop();
  if (wake) sleep.push([x0, wake.t]);
  if (bed) sleep.push([bed.t, x1]);
  const hours = [0, 6, 12, 18, 24].map(hh => x0 + hh * H);
  return `<svg class="hchart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Estimated level across today, hour by hour">
    ${sleep.map(([a, b]) => `<rect x="${X(Math.max(x0, a)).toFixed(1)}" y="${top}" width="${Math.max(0, X(Math.min(x1, b)) - X(Math.max(x0, a))).toFixed(1)}" height="${h - top - bot}" fill="rgba(125,122,255,.1)"/>`).join('')}
    ${band ? `<rect x="6" y="${Y(65)}" width="${W - 12}" height="${Y(35) - Y(65)}" fill="rgba(48,209,88,.07)"/>` : ''}
    ${[25, 50, 75].map(g => `<line x1="6" x2="${W - 6}" y1="${Y(g)}" y2="${Y(g)}" stroke="rgba(255,255,255,${g === 50 ? .12 : .05})" stroke-dasharray="${g === 50 ? '' : '2 4'}"/>`).join('')}
    <path d="${line} L${X(x1)},${h - bot} L${X(x0)},${h - bot} Z" fill="${color}" opacity=".12"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
    ${now > x0 && now < x1 ? `<line x1="${X(now)}" x2="${X(now)}" y1="${top - 4}" y2="${h - bot}" stroke="rgba(255,255,255,.55)" stroke-dasharray="3 3"/><circle cx="${X(now)}" cy="${Y(D.out.now[k])}" r="4.5" fill="#fff" stroke="${color}" stroke-width="2"/>` : ''}
    ${ev.filter(e => e.t >= x0 && e.t <= x1).map(e => `<text x="${X(e.t).toFixed(1)}" y="13" text-anchor="middle" font-size="11">${EV_ICON[e.kind]}</text>`).join('')}
    ${hours.map(t => `<text x="${X(t).toFixed(1)}" y="${h - 5}" text-anchor="${t === x0 ? 'start' : t === x1 ? 'end' : 'middle'}" font-size="10" fill="rgba(235,240,245,.45)" font-family="system-ui">${t === x1 ? '24:00' : hm(t)}</text>`).join('')}
  </svg>`;
}
function histChart(a, color, band) {
  const hs = (a.hist || []).filter(x => x && x[1] != null);
  if (hs.length < 2) return '<div class="sub" style="padding:10px 0">The daily line starts once the PC has estimated two days.</div>';
  const W = 340, h = 130, top = 10, bot = 20;
  const X = i => 6 + i / (hs.length - 1) * (W - 12), Y = v => top + (1 - v / 100) * (h - top - bot);
  const line = hs.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(p[1]).toFixed(1)).join(' ');
  const lab = i => fmtDay(hs[i][0], { day: 'numeric', month: 'short' });
  return `<svg class="hchart" viewBox="0 0 ${W} ${h}" role="img" aria-label="Daily estimate, last ${hs.length} days">
    ${band ? `<rect x="6" y="${Y(65)}" width="${W - 12}" height="${Y(35) - Y(65)}" fill="rgba(48,209,88,.07)"/>` : ''}
    ${[25, 50, 75].map(g => `<line x1="6" x2="${W - 6}" y1="${Y(g)}" y2="${Y(g)}" stroke="rgba(255,255,255,${g === 50 ? .12 : .05})" stroke-dasharray="${g === 50 ? '' : '2 4'}"/>`).join('')}
    <line x1="${X(hs.length - 1)}" x2="${X(hs.length - 1)}" y1="${Y(a.hi)}" y2="${Y(a.lo)}" stroke="${color}" stroke-width="6" stroke-linecap="round" opacity=".3"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>
    ${hs.map((p, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${i === hs.length - 1 ? 3.5 : 1.8}" fill="${color}"/>`).join('')}
    <text x="6" y="${h - 5}" font-size="10" fill="rgba(235,240,245,.45)" font-family="system-ui">${lab(0)}</text>
    <text x="${W - 6}" y="${h - 5}" text-anchor="end" font-size="10" fill="rgba(235,240,245,.45)" font-family="system-ui">today</text>
  </svg>`;
}

/* ── estimated blood level (logic/labs.ts) ── */
const pctTxt = x => (x >= 0 ? '+' : '−') + Math.abs(Math.round(x * 100)) + '%';
export function labFor(v, a) {
  const sp = L.specimen(v.profile || {}) || {};
  return L.labEstimate({ k: a.k, score: a.score, lo: a.lo, hi: a.hi, ref: a.ref, pos: a.pos, neg: a.neg, hist: a.hist },
    { age: sp.age || null, sex: (v.profile || {}).sex || 'male', blood: v.bloodwork || [], today: today() });
}
/* Where the estimate sits against men of the same age: their range shaded, yours as the dot and bar. */
function labScale(E, color) {
  const W = 320, h = 34, lo = Math.min(E.typical.lo, E.lo) * 0.8, hi = Math.max(E.typical.hi, E.hi) * 1.15;
  const X = x => 4 + (Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * (W - 8);
  const fmt = x => E.kind === 'output' ? Math.round(x) + '%' : Number(x).toFixed(E.digits);
  return `<svg class="hlb-scale" viewBox="0 0 ${W} ${h}" role="img" aria-label="Your estimate against the typical range for your age">
    <rect x="4" y="9" width="${W - 8}" height="6" rx="3" fill="rgba(255,255,255,.06)"/>
    <rect x="${X(E.typical.lo).toFixed(1)}" y="9" width="${(X(E.typical.hi) - X(E.typical.lo)).toFixed(1)}" height="6" rx="3" fill="rgba(255,255,255,.16)"/>
    <rect x="${X(E.lo).toFixed(1)}" y="7" width="${Math.max(2, X(E.hi) - X(E.lo)).toFixed(1)}" height="10" rx="5" fill="${color}" opacity=".35"/>
    <circle cx="${X(E.value).toFixed(1)}" cy="12" r="5.5" fill="#fff" stroke="${color}" stroke-width="2.5"/>
    <text x="${X(E.typical.lo).toFixed(1)}" y="31" text-anchor="middle" font-size="10" fill="rgba(235,240,245,.5)" font-family="system-ui">${fmt(E.typical.lo)}</text>
    <text x="${X(E.typical.hi).toFixed(1)}" y="31" text-anchor="middle" font-size="10" fill="rgba(235,240,245,.5)" font-family="system-ui">${fmt(E.typical.hi)}</text>
  </svg>`;
}
function labCard(v, a) {
  const E = labFor(v, a);
  if (!E) return '';
  if (E.kind === 'none') return `<div class="grp-h">Blood level</div><section class="card frost tight hlb"><div class="eyebrow">${esc(E.test)}</div><p class="hlb-how" style="margin-top:6px">${esc(E.note)}</p></section>`;
  const out = E.kind === 'output', u = out ? '%' : E.unit, nf = x => Number(x).toFixed(E.digits);
  const inRange = E.value >= E.typical.lo && E.value <= E.typical.hi;
  const good = E.better === 'band' ? inRange : E.better === 'lower' ? E.vsTypical <= 0.05 : E.vsTypical >= -0.05;
  const warn = E.better === 'band' ? !inRange : Math.abs(E.vsTypical) > 0.15;
  const tcol = good ? '#30d158' : warn ? '#ffb340' : 'var(--t2)';
  const tag = Math.abs(E.vsTypical) < 0.03 ? 'typical for your age' : `${pctTxt(E.vsTypical)} vs typical`;
  const sp = L.specimen(v.profile || {}) || {}, bf = (v.profile || {}).bodyfat;
  const row = (l, r) => `<div class="hlb-row"><span>${l}</span><b class="num">${r}</b></div>`;
  const unitTxt = x => out ? nf(x) + '%' : `${nf(x)}${u ? ' ' + esc(u) : ''}`;
  return `<div class="grp-h">${out ? "Estimated daily output" : "Estimated blood level"}</div>
    <section class="card frost tight hlb">
      <div class="hlb-top">
        <div style="min-width:0"><div class="eyebrow">${esc(E.test)}${E.anchored ? ' · from your lab' : ''}</div>
          <div class="hlb-v num">≈ ${nf(E.value)}<small>${out ? '%' : u ? ' ' + esc(u) : ''}</small></div>
          <div class="sub">likely ${nf(E.lo)}–${nf(E.hi)}${out ? '% of a typical 25-year-old' : ''}${E.si ? ` · ≈ ${E.si.value} ${esc(E.si.unit)}` : ''}</div>
          ${E.insulin ? `<div class="sub">fasting insulin ≈ ${E.insulin.value} µIU/mL (at glucose 90 mg/dL)</div>` : ''}</div>
        <span class="tag" style="--c:${tcol};color:${tcol}">${tag}</span></div>
      ${labScale(E, a.c)}
      <div class="hlb-rows">
        ${row(`Typical man your age (${E.typical.age})`, unitTxt(E.typical.value))}
        ${Math.abs(E.ageEffect) >= 0.01 ? row(`Age ${E.typical.age} vs 25`, pctTxt(E.ageEffect)) : ''}
        ${E.anchored ? row(`Your lab · ${fmtDay(E.anchored.date, { day: 'numeric', month: 'short' })}`, `${esc(String(E.anchored.value))} ${esc(E.anchored.unit || '')}`) + row('Change in your logs since', pctTxt(E.anchored.shift))
          : row('Your logs — sleep, food, training, stress, supplements', pctTxt(E.lifestyle))}
      </div>
      <div class="sub" style="margin-top:6px;font-size:.76rem;line-height:1.45">Typical range ${nf(E.typical.lo)}–${nf(E.typical.hi)}${out ? '%' : u ? ' ' + esc(u) : ''}: ${esc(E.typical.who)}. Based on age ${sp.age || '—'}${bf ? ` · body fat ${bf}%` : ''} · ${(v.endo && v.endo.days) || '—'} days of logs.</div>
      <p class="hlb-how"><b>How it’s tested</b> ${esc(E.how)}</p>
      <p class="hlb-src">${E.sources.map(x => `<a href="https://doi.org/${esc(x.doi)}" target="_blank" rel="noopener" title="${esc(x.cite)}">${esc(x.cite.split(',')[0])}</a>`).join(' · ')}</p>
    </section>`;
}

/* ── the list on Body Arch ── */
export function hormoneRows(v) {
  const D = hormoneDay(), axes = (v.endo && v.endo.axes) || [];
  return `<section class="list frost hlist">${axes.map(a => {
    const info = HORMONE_INFO[a.k] || [a.name, ''], now = D.out.now[a.k];
    const tr = a.trend === 'rising' ? '↗' : a.trend === 'falling' ? '↘' : '→';
    return `<button class="li hrow" data-act="hormone" data-k="${a.k}" style="--c:${a.color}">
      <span class="ic" style="--c:${a.c}">${a.ic}</span>
      <span class="tx"><div class="tt">${esc(info[0])}</div><div class="st"><span style="color:${a.color}">${esc(statusText(a.status))}</span> · today ${a.score} ${tr}</div></span>
      ${spark(D.out.points[a.k], a.c)}
      <span class="hnow"><b class="num" style="color:${a.color}">${isNaN(now) ? a.score : now}</b><small>now</small></span></button>`;
  }).join('')}</section>`;
}

let hSeg = 'today';
function hormoneSheet(k) {
  hSeg = 'today';
  const s = openSheet({
    id: 'hormone', title: (HORMONE_INFO[k] || [k])[0],
    render: () => {
      const v = view(), a = ((v.endo && v.endo.axes) || []).find(x => x.k === k);
      if (!a) return '<div class="empty">No estimate for this axis yet.</div>';
      const D = hormoneDay(), info = HORMONE_INFO[k] || [a.name, ''];
      const now = D.out.now[k], pk = D.out.peak[k], lo = D.out.low[k];
      const cw = a.conf >= 0.55 ? ['Good', '#30d158'] : a.conf >= 0.3 ? ['Partial', '#ffb340'] : ['Low', '#ff6b5a'];
      const labs = L.bloodMarkers(v.bloodwork || []).find(m => m.axis === k);
      const E = labFor(v, a), dp = E && E.kind !== 'none' ? Object.fromEntries(E.drivers.map(d => [d.label, d.pct])) : {};
      const dpTxt = l => dp[l] === undefined || Math.abs(dp[l]) < 0.005 ? '' : `<b class="num">≈ ${pctTxt(dp[l])}${E.k === 'insulinSensitivity' ? ' HOMA' : ''}</b>`;
      const drv = (list, title, col) => (list || []).length ? `<div class="hdh" style="color:${col}">${title}</div>` + list.map(x => `<div class="hd"><span style="color:${col}">●</span><span>${esc(plain(x.label))}</span>${dpTxt(x.label)}</div>`).join('') : '';
      return `<div class="hhead" style="--c:${a.color}">
          <div><div class="eyebrow">Now · ${hm(Date.now())}</div><div class="hbig num">${isNaN(now) ? a.score : now}</div></div>
          <div class="hsum"><span class="tag" style="--c:${a.color}">${esc(statusText(a.status))}</span>
            <div class="sub">Today's level <b style="color:var(--t1)">${a.score}</b> (likely ${a.lo}–${a.hi})</div>
            <div class="sub">${a.trend === 'rising' ? '↗ rising' : a.trend === 'falling' ? '↘ falling' : '→ steady'} over recent days</div></div></div>
        <p class="hwhat">${esc(info[1])}</p>
        ${labCard(v, a)}
        <div class="grp-h">Through the day</div>
        <div class="seg" style="margin:4px 0 10px">${[['today', 'Today by the hour'], ['days', 'Last 21 days']].map(([x, l]) => `<button class="${hSeg === x ? 'on' : ''}" data-act="h-seg" data-v="${x}">${l}</button>`).join('')}</div>
        <section class="card frost tight">${hSeg === 'today' ? dayChart(k, D, a.c, a.band)
          + `<div class="row num sub" style="gap:14px;margin-top:6px;font-size:.78rem;flex-wrap:wrap">${pk ? `<span>Peak <b style="color:var(--t1)">${hm(pk.t)}</b> · ${pk.v}</span>` : ''}${lo ? `<span>Low <b style="color:var(--t1)">${hm(lo.t)}</b> · ${lo.v}</span>` : ''}<span>🌙 shaded = sleep</span></div>`
          : histChart(a, a.c, a.band) + `<div class="sub" style="font-size:.76rem;margin-top:6px">One point per day: the engine's daily estimate. The bar on today is its likely range.</div>`}</section>
        ${(D.out.notes[k] || []).length ? `<div class="grp-h">Today</div><section class="card frost tight hnotes">${D.out.notes[k].map(n => `<p>${esc(n)}</p>`).join('')}</section>` : ''}
        ${(a.pos && a.pos.length) || (a.neg && a.neg.length) ? `<div class="grp-h">What moves your level</div><section class="card frost tight hdrv">
          ${drv(a.pos, 'Raising it', '#30d158')}${drv(a.neg, 'Lowering it', '#ff6b5a')}</section>` : ''}
        ${labs ? `<div class="grp-h">Your lab result</div><section class="card frost tight"><b>${esc(labs.latest.marker)} ${esc(String(labs.latest.value))} ${esc(labs.latest.unit || '')}</b>
          <div class="sub">${fmtDay(labs.latest.date, { day: 'numeric', month: 'short', year: 'numeric' })} · shown beside the estimate, never mixed into it</div></section>` : ''}
        <div class="hconf"><span>Confidence <b style="color:${cw[1]}">${cw[0]}</b></span>${(a.missing || []).filter(x => !/^(alcohol|illness|nicotine)$/i.test(x)).length ? `<span class="sub">Log ${esc((a.missing || []).filter(x => !/^(alcohol|illness|nicotine)$/i.test(x)).slice(0, 3).join(', ').toLowerCase())} to sharpen it</span>` : ''}</div>
        <p class="sub" style="line-height:1.5;margin:10px 0 0">The 0–100 score is the engine's estimate of physiological state; the blood level places it on published ranges for men your age. Both are estimates from your logs, not measurements — only a blood test gives your actual number. The hourly shape uses typical body-clock rhythms and today's events.</p>`;
    },
  });
  s.seg = x => { hSeg = x; s.refresh(); };
}

export const actions = {
  hormone(d) { haptic(); hormoneSheet(d.k); },
  'h-seg'(d) { const s = topSheet(); if (s && s.seg) { haptic(); s.seg(d.v); } },
};
