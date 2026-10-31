/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Body Arch, entire.

   The same sections as on the PC, in the same order, fitted to a phone:
   Scanner (the figure, overlays, timeline) · Biometric Status · Body Systems
   (readiness, report card, body age, Bio-Regen Matrix) · Development · Mind ·
   Supplements · Endocrine. Each section folds to a one-line summary (Scanner open); the
   chips open and jump, "Open all" shows the whole page.

   Everything you can log on the PC's Body Arch you can log here. Physique and
   the endocrine estimate are shown as the PC last computed them; the shared
   maths (readiness, figure colours, profile, progression) runs here too from
   ARK_LOGIC, so it answers instantly and agrees with the PC.
   ══════════════════════════════════════════════════════════════════════ */
import {
  L, state, view, emit, emitUndoable, dropPending, changed, esc, icon, today, shiftDay, fmt1, fmtDay, ringSvg, sparkSvg, barsSvg,
  haptic, toast, openSheet, topSheet, closeSheet, scheduleSync, daysBetween,
} from './core.js';
import { GROUPS, syncButton, bioPatch, MOODS } from './views.js';
import { startForMuscles, tissueNow } from './train.js';
import { secMind } from './mind.js';
import { standing, fmtAmt, usualOf, hm } from './doses.js';
import { logRows } from './logui.js';
import { hormoneRows } from './hormones.js';
import { rebuildNow } from './rebuild.js';
import { fatigueCard, fatigueNow } from './system.js';

const ui = { face: 'front', mode: 'status', tl: 0, sel: null, open: {} };
const MODES = [['status', 'Status'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['soreness', 'Soreness'], ['volume', 'Thermal'], ['range', 'Range']];
const SECTIONS = [['ba-scan', 'Scanner'], ['ba-vit', 'Biometric'], ['ba-sys', 'Systems'], ['ba-dev', 'Develop'], ['ba-mind', 'Mind'], ['ba-mic', 'Supplements'], ['ba-endo', 'Endocrine']];
const STATE_LBL = {
  fresh: ['Fresh', '#30d158'], recovering: ['Recovering', '#ffb340'], ready: ['Ready', '#40c8e0'],
  detrained: ['Detrained', '#ff6b5a'], untouched: ['Untouched', 'rgba(235,240,245,.5)'],
};
const SW_TYPE_COLORS = { push: '#f87171', pull: '#818cf8', legs: '#22c55e', core: '#a78bfa', full: '#22d3ee' };
const REGEN_LBL = { dormant: ['Dormant', 'rgba(235,240,245,.45)'], charging: ['Charging', '#ffb340'], primed: ['Primed', '#30d158'], detraining: ['Detraining', '#ffb340'], atrophy: ['Losing', '#ff6b5a'] };
const SORE_COLORS = ['rgba(34,197,94,.6)', 'rgba(234,179,8,.8)', 'rgba(249,115,22,.9)', 'rgba(239,68,68,.95)', '#dc2626'];
const SORE_LBL = ['None', 'Mild', 'Sore', 'High', 'Injured'];

const bySlug = v => Object.fromEntries(v.body.muscles.map(m => [m.slug, m]));
const ago = h => h == null ? 'never' : h < 24 ? Math.max(1, Math.round(h)) + ' h ago' : Math.round(h / 24) + ' d ago';
const latestWeight = v => { const k = Object.keys(v.weights).sort().pop(); return k ? v.weights[k] : (v.profile.weight || null); };
const MUS_STATE = { fresh: 'just trained', recovering: 'recovering', ready: 'ready to train', detrained: 'fading', untouched: 'not trained yet' };
const card = (inner, cls = '') => `<section class="card frost ${cls}">${inner}</section>`;

/* ══════════════ the figure: built once, repainted in place ══════════════ */
let figEl = null;
const vbox = {};
function figure() {
  if (figEl) return figEl;
  const MN = window.ARK_MNAME || {};
  const face = (name, groups, outline) => `<g class="face ${name}">`
    + `<path class="outline" d="${outline}"/>`
    + groups.map(g => MN[g.slug]
      ? `<g class="mus" data-act="muscle" data-slug="${g.slug}" role="button" tabindex="0" aria-label="${MN[g.slug]}">${g.paths.map(p => `<path d="${p}"/>`).join('')}</g>`
      : `<g class="part">${g.paths.map(p => `<path d="${p}"/>`).join('')}</g>`).join('')
    + `</g>`;
  const host = document.createElement('div');
  host.innerHTML = `<svg class="ba-fig" viewBox="0 0 724 1448" preserveAspectRatio="xMidYMid meet" role="group" aria-label="Body figure — each muscle opens its details">`
    + face('front', window.ARK_FRONT || [], window.ARK_OUTLINE_FRONT || '')
    + face('back', window.ARK_BACK || [], window.ARK_OUTLINE_BACK || '') + `</svg>`;
  figEl = host.firstChild;
  return figEl;
}
/** Put the figure into the freshly rendered page and fit it to the visible face. */
export function mountFigure() {
  const host = document.getElementById('ba-fig-host');
  if (!host || !window.ARK_FRONT) return;
  const svg = figure();
  if (svg.parentNode !== host) host.appendChild(svg);
  svg.querySelectorAll('.face').forEach(f => {
    const on = f.classList.contains(ui.face);
    f.classList.toggle('on', on);
    // VoiceOver and the keyboard reach only the face on screen.
    f.setAttribute('aria-hidden', on ? 'false' : 'true');
    f.querySelectorAll('g.mus').forEach(g => g.setAttribute('tabindex', on ? '0' : '-1'));
  });
  if (!vbox[ui.face]) {
    try {
      const b = svg.querySelector('.face.' + ui.face).getBBox();
      if (b.width > 10) { const p = 18; vbox[ui.face] = `${b.x - p} ${b.y - p} ${b.width + p * 2} ${b.height + p * 2}`; }
    } catch (e) { /* not laid out yet */ }
  }
  if (vbox[ui.face]) svg.setAttribute('viewBox', vbox[ui.face]);
  paint();
  watchSections();
}
function paint() {
  if (!figEl) return;
  const v = view(), by = bySlug(v), pins = v.body.pins || {};
  const tlE = ui.tl ? (v.body.timeline || [])[ui.tl] : null;
  const now = Date.now() - ui.tl * 864e5;
  figEl.querySelectorAll('g.mus').forEach(g => {
    const s = g.dataset.slug, m = by[s] || {};
    const last = tlE ? ((tlE.muscles || {})[s] || {}).last : m.last;
    const p = L.muscleFill(ui.mode, { strength: m.strength || 0, mobility: m.mobility || 0, soreness: soreOf(v, s).level, soreTs: 0 }, last || null, m.vol30 || 0, v.body.peak || 1, now, s === ui.sel, volOf(v, s, m).zone);
    g.style.fill = p ? p.fill : '';
    g.style.stroke = p ? p.stroke : '';
    g.classList.toggle('sel', s === ui.sel);
    g.classList.toggle('pin', !!pins[s]);
    const st = MUS_STATE[m.state] || '';
    g.setAttribute('aria-label', (m.name || (window.ARK_MNAME || {})[s] || s) + (st ? ', ' + st : '') + (m.hoursSince != null ? ', trained ' + ago(m.hoursSince) : '') + (pins[s] ? ', pinned' : ''));
    g.setAttribute('aria-pressed', s === ui.sel ? 'true' : 'false');
  });
}

/* ══════════════ sections ══════════════ */
function legend() {
  if (ui.mode === 'status') return `<span><i style="background:rgba(34,197,94,.6)"></i>Fresh ≤48 h</span><span><i style="background:rgba(245,158,11,.6)"></i>Recovering → 7 d</span><span><i style="background:rgba(112,140,178,.35)"></i>Idle</span><span><i style="background:rgba(239,68,68,.6)"></i>Sore (estimated)</span>`;
  if (ui.mode === 'soreness') return SORE_LBL.map((l, i) => `<span><i style="background:${SORE_COLORS[i]}"></i>${l}</span>`).join('');
  if (ui.mode === 'range') return ['under', 'low', 'optimal', 'high', 'over'].map(k => `<span><i style="background:${L.VOLUME_ZONE[k].color}"></i>${L.VOLUME_ZONE[k].label.replace(/ —.*/, '')}</span>`).join('');
  if (ui.mode === 'volume') return `<span>30-day tonnage · none</span><span class="ramp"></span><span>your hardest-hit</span>`;
  const c = ui.mode === 'strength' ? '34,197,94' : '34,211,238';
  return `<span><i style="background:rgba(${c},.15)"></i>1</span><span><i style="background:rgba(${c},.45)"></i>5</span><span><i style="background:rgba(${c},.78)"></i>10 · your rating</span>`;
}
function scanStats(v) {
  const tlE = ui.tl ? (v.body.timeline || [])[ui.tl] : null;
  const c = v.body.counts || {};
  const ready = tlE ? tlE.ready : c.ready, rec = tlE ? tlE.recovering : (c.recovering || 0) + (c.fresh || 0);
  const cov = tlE ? tlE.coverage : v.body.coverage;
  const bal = v.body.balance;
  return `<div class="frost"><div class="v num" style="color:#30d158">${ready ?? '—'}</div><div class="k">Ready to train</div></div>
    <div class="frost"><div class="v num" style="color:#ffb340">${rec ?? '—'}</div><div class="k">Recovering</div></div>
    <div class="frost"><div class="v num" style="color:#40c8e0">${cov == null ? '—' : cov + '%'}</div><div class="k">7-day coverage</div></div>
    <div class="frost"><div class="v num" style="color:#bf5af2">${bal == null ? '—' : bal + '%'}</div><div class="k">Antagonist balance</div>
      ${bal == null ? '<div class="s">needs volume on both sides</div>' : ''}</div>`;
}
function tlLabel() { return ui.tl === 0 ? 'Live' : ui.tl === 1 ? 'Yesterday' : ui.tl + ' days ago'; }

function secScanner(v) {
  let H = `<section class="scan frost">
    <div class="scan-top"><div class="seg sm">
      <button class="${ui.face === 'front' ? 'on' : ''}" data-act="ba-face" data-face="front">Anterior</button>
      <button class="${ui.face === 'back' ? 'on' : ''}" data-act="ba-face" data-face="back">Posterior</button></div></div>
    <div class="modes">${MODES.map(m => `<button class="chip ${ui.mode === m[0] ? 'on' : ''}" data-act="ba-mode" data-mode="${m[0]}">${m[1]}</button>`).join('')}</div>
    <div class="fig-wrap"><div class="fig-floor"></div><div id="ba-fig-host" style="position:absolute;inset:0"></div>
      <div class="fig-hint">Tap a muscle</div></div>
    <div class="fig-legend">${legend()}</div>
    <div class="tl"><span class="k">Timeline</span>
      <input type="range" min="0" max="14" step="1" value="${14 - ui.tl}" data-tl aria-label="Timeline — days back">
      <span class="v ${ui.tl ? '' : 'live'}" data-tl-label>${tlLabel()}</span></div>
  </section>
  <div class="stat4" data-scan-stats>${scanStats(v)}</div>`;

  return H;
}

function radarSvg(summary) {
  const n = summary.length, cx = 70, cy = 70, R = 48;
  const pt = (i, r) => { const a = (-90 + i * 360 / n) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  let g = '';
  [0.25, 0.5, 0.75, 1].forEach(lv => { g += `<polygon points="${summary.map((_, i) => pt(i, R * lv).map(x => x.toFixed(1)).join(',')).join(' ')}" fill="none" stroke="rgba(255,255,255,${lv === 1 ? .16 : .07})"/>`; });
  summary.forEach((s, i) => {
    const e = pt(i, R), l = pt(i, R + 13);
    g += `<line x1="${cx}" y1="${cy}" x2="${e[0].toFixed(1)}" y2="${e[1].toFixed(1)}" stroke="rgba(255,255,255,.07)"/>`;
    g += `<text x="${l[0].toFixed(1)}" y="${(l[1] + 3).toFixed(1)}" text-anchor="middle" font-size="8.5" font-weight="800" fill="${s.color}" font-family="system-ui">${esc(s.name.slice(0, 3))}</text>`;
  });
  const poly = summary.map((s, i) => pt(i, R * Math.max(0.02, s.imprint / 100)).map(x => x.toFixed(1)).join(',')).join(' ');
  g += `<polygon points="${poly}" fill="rgba(64,200,224,.18)" stroke="#40c8e0" stroke-width="1.6" stroke-linejoin="round"/>`;
  return `<svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Strength radar">${g}</svg>`;
}
function secRecovery(v) {
  const R = v.body.regen;
  if (!R) return card(`<div class="empty">The Bio-Regen Matrix appears after the first sync with a PC that has it.</div>`);
  const S = R.summary;
  let H = `<div class="agg4">
    <div class="frost"><div class="v num" style="color:#40c8e0">${R.lvl}</div><div class="k">${R.lvlLabel || 'Specimen lvl'}</div></div>
    <div class="frost"><div class="v num" style="color:#30d158">${R.impAvg}%</div><div class="k">Imprint</div></div>
    <div class="frost"><div class="v num" style="color:#ffb340">${R.weekSets}</div><div class="k">Sets / wk</div></div>
    <div class="frost"><div class="v num" style="color:#bf5af2">${R.primed}/6</div><div class="k">Primed</div></div></div>`;
  const n = {}; S.forEach(s => { n[s.state] = (n[s.state] || 0) + 1; });
  const dom = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  if (S.length >= 6 && n[dom] >= 4) {
    const col = (REGEN_LBL[dom] || REGEN_LBL.dormant)[1];
    // Gains hold for about two weeks off and fade with longer breaks (Bosquet 2013) — not "atrophy" after 7 days.
    const txt = { dormant: 'dormant — never trained', charging: 'charging — inside the recovery window', primed: 'primed — recovered, gains intact', detraining: 'detraining — 2–4 weeks off, gains starting to fade', atrophy: 'losing — over 4 weeks off, size and strength fading' }[dom];
    H += `<div class="uni frost" style="--uc:${col}"><span class="dot"></span><span><b>${n[dom]} of 6 groups</b> ${txt}</span></div>`;
  }
  H += `<div class="grp2">${S.map(s => {
    const st = REGEN_LBL[s.state] || REGEN_LBL.dormant;
    return `<div class="gc frost" style="--gcc:${s.color}"><div class="top"><span>${s.icon}</span>${esc(s.name.charAt(0) + s.name.slice(1).toLowerCase())}<span class="tag" style="--c:${st[1]}">${st[0].toUpperCase()}</span></div>
      <div class="rb"><i style="width:${s.fillPct}%;background:${s.fillCol}"></i></div>
      <div class="rm"><span>Recovery ${esc(s.pctTxt)}</span><span>${esc(String(s.lastTxt).replace('last: ', ''))}</span></div>
      <div class="mini"><span>IMPRINT</span><span class="t"><i style="width:${s.imprint}%;background:#30d158"></i></span><b>${s.imprint ? s.imprint + '%' : '—'}</b>
        <span>MOBILITY</span><span class="t"><i style="width:${s.mobPct}%;background:#40c8e0"></i></span><b>${s.mobPct ? s.mobPct + '%' : '—'}</b>
        <span>VOL/WK</span><span class="t"><i style="width:${s.volPct}%;background:${s.volCol || '#ffb340'}"></i></span><b style="${s.volCol ? 'color:' + s.volCol : ''}">${s.wkTxt || s.wk + '/10'}</b></div></div>`;
  }).join('')}</div>`;
  // Strength imprint per group (no training pick — TRAIN NEXT was removed from Body Arch, 2026-10-04).
  const byImp = S.slice().sort((a, b) => b.imprint - a.imprint);
  H += card(`<div class="radar-row"><div>${radarSvg(S)}</div><div class="np">
    <div class="hl">Strength imprint</div><div class="why">How strong each group is for your body weight — your best lifts against population standards. Further out is stronger.</div>
    ${byImp.map(s => `<div class="pick">${esc(s.name.charAt(0) + s.name.slice(1).toLowerCase())}<span class="tag" style="--c:${s.imprint >= 50 ? '#30d158' : s.imprint >= 20 ? '#ffb340' : 'rgba(235,240,245,.45)'}">${s.imprint}%</span></div>`).join('')}
  </div></div>`, 'tight').replace('card frost tight', 'card frost tight" style="margin-top:10px');
  return H;
}

/* ── profile ── */
const PFIELDS = [
  ['height', 'Height', 'cm'], ['bodyfat', 'Body fat', '%'], ['vo2max', 'VO₂max', 'ml/kg/min'],
  ['goalWeight', 'Goal weight', 'kg'], ['birthday', 'Birthday', ''], ['priorWorkouts', 'Workouts before ARK', ''],
];
function secProfile(v) {
  const p = Object.assign({}, v.profile), w = latestWeight(v);
  if (w) p.weight = w;
  const sp = L.specimen(p);
  const career = v.career || { logged: v.workouts.length, prior: 0 };
  const total = career.logged + career.prior;
  const rank = total >= 400 ? ['VETERAN', '#ffd60a'] : total >= 150 ? ['ADVANCED', '#30d158'] : total >= 50 ? ['INTERMEDIATE', '#40c8e0'] : ['NOVICE', 'rgba(235,240,245,.6)'];
  let H = `<div style="margin:-2px 2px 10px"><span class="badge" style="--bc:${rank[1]}">${rank[0]} · ${career.logged} LOGGED${career.prior ? ' + ' + career.prior + ' PRIOR' : ''}</span></div>`;
  const val = (k, u) => {
    const x = v.profile[k];
    if (x === undefined || x === null || x === '') return `<span class="val none">Not set</span>`;
    if (k === 'birthday') return `<span class="val">${esc(fmtDay(String(x), { day: 'numeric', month: 'short', year: 'numeric' }))}${sp.age != null ? ' · ' + sp.age : ''}</span>`;
    return `<span class="val">${esc(fmt1(+x))}${u ? ' ' + u : ''}</span>`;
  };
  if (v.profileSaved === false) H += `<p class="sub" style="margin:-2px 4px 10px;line-height:1.45">Showing ARK's built-in profile — change any value and it becomes yours.</p>`;
  H += `<section class="list frost fields">
    <button class="li" data-act="weigh-sheet"><span class="tx"><div class="tt">Weight</div></span><span class="val ${w ? '' : 'none'}">${w ? fmt1(w) + ' kg' : 'Weigh in'}</span><span class="chev">${icon('chev', 15)}</span></button>
    ${PFIELDS.map(f => `<button class="li" data-act="prof-edit" data-k="${f[0]}"><span class="tx"><div class="tt">${f[1]}</div></span>${val(f[0], f[2])}<span class="chev">${icon('chev', 15)}</span></button>`).join('')}
    <div class="segrow"><span class="eyebrow">Activity level</span><div class="seg sm">${[['sedentary', 'Sed'], ['light', 'Light'], ['moderate', 'Mod'], ['active', 'Active'], ['athlete', 'Athl']].map(a =>
      `<button class="${v.profile.activity === a[0] ? 'on' : ''}" data-act="prof-set" data-k="activity" data-v="${a[0]}">${a[1]}</button>`).join('')}</div></div>
    <div class="segrow"><span class="eyebrow">Biological sex</span><div class="seg sm">${[['male', 'Male'], ['female', 'Female']].map(a =>
      `<button class="${v.profile.sex === a[0] ? 'on' : ''}" data-act="prof-set" data-k="sex" data-v="${a[0]}">${a[1]}</button>`).join('')}</div></div>
  </section>`;

  /* goal + weight trend */
  const wk = Object.keys(v.weights).sort();
  if (p.goalWeight && w) {
    const start = wk.length ? v.weights[wk[0]] : w, goal = +p.goalWeight;
    const dir = goal > start ? 'gain' : goal < start ? 'lose' : 'hold';
    const done = dir === 'gain' ? w - start : dir === 'lose' ? start - w : 0;
    const pct = Math.max(0, Math.min(100, Math.round(done / (Math.abs(goal - start) || 1) * 100)));
    const left = Math.abs(goal - w), reached = dir === 'hold' || left <= 0.1 || pct >= 100;
    H += card(`<div class="row"><span class="eyebrow" style="flex:1">◎ Goal · ${dir === 'gain' ? 'lean bulk' : dir === 'lose' ? 'cut' : 'maintain'} → ${fmt1(goal)} kg</span>
      <b style="color:${reached ? '#30d158' : '#40c8e0'};font-size:.82rem">${reached ? '✓ Reached' : (dir === 'gain' ? '▲ ' : '▼ ') + fmt1(left) + ' kg to go'}</b></div>
      <div class="goalbar"><div class="bar" style="--c:${reached ? '#30d158' : '#40c8e0'}"><i style="width:${pct}%"></i></div>
      <div class="row num"><span>start ${fmt1(start)}</span><span>now ${fmt1(w)}</span><span>goal ${fmt1(goal)}</span></div></div>`).replace('class="card frost "', 'class="card frost" style="margin-top:10px"');
  }
  const pts = wk.slice(-90).map(k => { const [y, m, d] = k.split('-').map(Number); return { t: new Date(y, m - 1, d).getTime(), y: v.weights[k] }; });
  H += `<section class="card frost" style="margin-top:10px"><div class="row"><span class="eyebrow" style="flex:1">⟿ Weight trend</span>
      <button class="btn sm btn-tint" style="--accent:#40c8e0" data-act="weigh-sheet">${icon('scale', 15)} Weigh in</button></div>
    ${pts.length >= 2 ? `<div style="margin-top:8px">${sparkSvg(pts, '#40c8e0')}</div><div class="sub">${pts.length} weigh-ins · ${fmt1(Math.min(...pts.map(x => x.y)))}–${fmt1(Math.max(...pts.map(x => x.y)))} kg</div>`
      : `<div class="sub" style="margin-top:8px">The trend draws from weigh-ins on two or more days.</div>`}</section>`;

  const tile = (v1, k, sub, c) => `<div><div class="v num"${c ? ` style="color:${c}"` : ''}>${v1}</div><div class="k">${k}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Composition</h2></div><div class="tiles5">
    ${tile(sp.age ?? '—', 'Age', v.profile.birthday ? '' : 'set birthday')}
    ${tile(sp.bmi ? sp.bmi.toFixed(1) : '—', 'BMI', sp.bmi ? sp.bmiNote : '', '#40c8e0')}
    ${tile(sp.lean && p.bodyfat ? sp.lean.toFixed(1) + 'kg' : '—', 'Lean mass', '', '#30d158')}
    ${tile(sp.fat && p.bodyfat ? sp.fat.toFixed(1) + 'kg' : '—', 'Fat mass', p.bodyfat ? p.bodyfat + '% · ' + sp.bf[0] : '', p.bodyfat ? sp.bf[1] : '')}
    ${tile(sp.ffmi && p.bodyfat ? sp.ffmi.toFixed(1) : '—', 'FFMI', sp.ffmi && p.bodyfat ? sp.ffmiNote : '', '#bf5af2')}
</div>
  <div class="ba-h"><h2 style="font-size:1.05rem">Energy & daily targets</h2></div><div class="tiles5">
    ${tile(sp.bmr && p.bodyfat ? sp.bmr.toLocaleString() : '—', 'BMR', 'kcal at rest', '#ff6b5a')}
    ${tile(sp.tdee && p.bodyfat ? sp.tdee.toLocaleString() : '—', 'TDEE', 'kcal · ' + (L.ACTIVITY_LABELS[p.activity] || 'Moderate'), '#ffb340')}
    ${tile(sp.protein ? sp.protein + 'g' : '—', 'Protein', '2.2 g/kg/day', '#30d158')}
    ${tile(sp.water ? sp.water.toFixed(1) + 'L' : '—', 'Water', '35 ml/kg/day', '#40c8e0')}
    ${tile(sp.idealLo ? Math.round(sp.idealLo) + '–' + Math.round(sp.idealHi) : '—', 'Ideal wt', 'kg · BMI 20–25', '#bf5af2')}</div>`;

  /* physique */
  const ph = v.body.physique;
  if (ph) {
    const rows = [
      ['Strength', ph.avgStr / 10, '#30d158', Math.round(ph.avgStr * 10) + '%'],
      ['Mobility', ph.mobKnown ? ph.avgMob / 10 : 0, '#40c8e0', ph.mobKnown ? Math.round(ph.avgMob * 10) + '%' : null],
      ['Coverage', ph.coverage, '#bf5af2', ph.cov + '/' + ph.n],
      ['Recovery', 1 - ph.avgSore / 4, '#ffb340', Math.round((1 - ph.avgSore / 4) * 100) + '%'],
    ];
    const hp = (ph.hist || []).map(x => { const [y, m, d] = x.d.split('-').map(Number); return { t: new Date(y, m - 1, d).getTime(), y: x.v }; });
    H += `<div class="ba-h"><h2 style="font-size:1.05rem">Physique development</h2><span class="k">structural index · 30-day arc</span></div>` + card(`<div class="pd">
      <div style="color:${ph.color}">${ringSvg(ph.index / 100, ph.color, 86, 9, ph.index)}</div>
      <div><div class="grade" style="color:${ph.color}">${esc(ph.grade)}</div><div class="eyebrow" style="margin-top:4px">Physique index</div></div></div>
      ${rows.map(r => `<div class="smrow"><span>${r[0]}</span><span class="t"><i style="width:${Math.round(r[1] * 100)}%;background:${r[2]}"></i></span><b class="${r[3] == null ? 'none' : ''}">${r[3] ?? 'not rated'}</b></div>`).join('')}
      ${(!ph.mobKnown || !ph.balKnown) ? `<p class="sub" style="margin:10px 0 0;line-height:1.45">${!ph.mobKnown && !ph.balKnown ? 'Mobility and balance' : !ph.mobKnown ? 'Mobility' : 'Balance'} not measured yet — left out of the index, not scored as zero.</p>` : ''}
      <div style="margin-top:10px">${hp.length >= 2 ? sparkSvg(hp, ph.color) : `<div class="sub">Baseline set — your development arc builds from here.</div>`}</div>`);
  }
  return H;
}

/* ── vitals ── */
function readinessCard(v, t) {
  const r = v.readiness[t];
  // Not scored yet today (nothing logged): show the last score, dimmed and dated, rather than an empty ring.
  let back = null; if (r == null) for (let i = 1; i <= 3 && back == null; i++) { const x = v.readiness[shiftDay(t, -i)]; if (x != null) back = { v: x, i }; }
  const rv = r != null ? r : back ? back.v : null;
  const col = rv == null ? 'rgba(235,240,245,.3)' : rv >= 80 ? '#30d158' : rv >= 60 ? '#ffd60a' : rv >= 40 ? '#ff9f0a' : '#ff453a';
  const lbl = rv == null ? 'Log data to score' : rv >= 90 ? 'Elite condition' : rv >= 80 ? 'Peak ready' : rv >= 70 ? 'Good to train' : rv >= 55 ? 'Train smart' : rv >= 40 ? 'Go light' : 'Recover';
  const hist = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(i => v.readiness[shiftDay(t, -i)]);
  const pres = hist.filter(x => x != null);
  const sub = r != null ? "From today's vitals — the same score your PC shows"
    : back ? (back.i === 1 ? "Yesterday's score" : back.i + ' days ago') + ' — sleep, energy or protein today updates it' : 'Sleep, energy, mood, water or protein — any one starts it';
  return card(`<div class="row" style="gap:16px">
      <div style="color:${col}${r == null && back ? ';opacity:.55' : ''}">${ringSvg(rv == null ? 0 : rv / 100, col, 80, 9, rv == null ? '—' : Math.round(rv))}</div>
      <div style="flex:1"><div class="eyebrow">Readiness${r == null && back ? ' · not scored today' : ''}</div><div style="font-size:1.2rem;font-weight:700;margin-top:2px">${lbl}</div>
        <div class="sub" style="margin-top:3px">${sub}</div></div></div>
    ${pres.length ? `<div class="row num" style="gap:14px;margin-top:10px;font-size:.78rem"><span><b>${Math.round(pres.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, pres.length))}</b> <span class="sub">7-day avg</span></span><span><b>${Math.max(...pres)}</b> <span class="sub">14-day best</span></span></div>
      <div class="strip7 in-card">${hist.slice(-7).map((r7, i) => { const k = shiftDay(t, i - 6), c7 = r7 == null ? '' : r7 >= 80 ? '#30d158' : r7 >= 60 ? '#ffd60a' : r7 >= 40 ? '#ff9f0a' : '#ff453a';
        const cf = (v.carry || {})[k] || {}, car7 = r7 != null && ['sleep', 'energy', 'mood', 'stress', 'hrv', 'rhr'].some(f => cf[f]);
        return `<div class="${k === t ? 't' : ''}${car7 ? ' c' : ''}"><b ${c7 ? `style="color:${c7}"` : ''}>${r7 ?? '—'}</b>${fmtDay(k, { weekday: 'narrow' })}</div>`; }).join('')}</div>` : ''}`);
}
function hud(v, t) {
  const d = v.bio[t] || {}, y = v.bio[shiftDay(t, -1)] || {}, G = (v.bioDefs && v.bioDefs.goals) || { cal: 2500, water: 3, sleep: 8 };
  const rd = v.readiness[t], ry = v.readiness[shiftDay(t, -1)];
  // A zero for food, water or sleep means "not logged yet" — shown as — with no arrow, never as a drop.
  const lg = x => (x == null || x === 0 ? null : x);
  const T = [
    // Today's food, water and sleep read 0 until you log them (2026-10-31); scores you rate stay "—".
    ['HEALTH', '#ff6b5a', rd, rd, '%', ry, 100],
    ['STAMINA', '#ffd60a', d.energy, d.energy, '/10', y.energy, 10],
    ['FOOD', '#ff9f0a', lg(d.cal) || 0, lg(d.cal) != null && d.cal >= 1000 ? fmt1(d.cal / 1000) + 'k' : (lg(d.cal) || 0), '', lg(y.cal), G.cal],
    ['WATER', '#40c8e0', lg(d.water) || 0, lg(d.water) != null ? fmt1(d.water) : 0, 'L', lg(y.water), G.water],
    ['OXYGEN', '#64d2ff', lg(d.sleep) || 0, lg(d.sleep) != null ? fmt1(d.sleep) : 0, 'h', lg(y.sleep), G.sleep],
    ['TORPOR', '#bf5af2', d.stress, d.stress, '/10', y.stress, 10, true],
  ];
  return `<div class="hud">${T.map(([n, c, cur, shown, unit, prev, max, inv]) => {
    let dl = '';
    if (cur != null && prev != null && cur !== 0) {
      const diff = cur - prev, good = inv ? diff < 0 : diff > 0;
      dl = Math.abs(diff) < 0.05 ? '<span class="d flat">±0</span>' : `<span class="d ${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'}${Math.abs(diff) >= 1 ? Math.round(Math.abs(diff)) : Math.abs(diff).toFixed(1)}</span>`;
    }
    const pct = cur == null ? 0 : Math.max(0, Math.min(100, cur / (max || 1) * 100));
    return `<div style="--hc:${c}"><div class="n">${n}</div><div class="v num">${cur == null ? '—' : shown + '<small>' + unit + '</small>'}${dl}</div><div class="b"><i style="width:${pct}%"></i></div></div>`;
  }).join('')}</div>`;
}
function secVitals(v) {
  const t = today();
  let H = `<div class="ba-h"><h2 style="font-size:1.05rem">Survivor vitals</h2><span class="k">vs yesterday</span></div>` + hud(v, t);
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Log today</h2><span class="k">${fmtDay(t, { weekday: 'long' })}</span></div>` + logRows(v, t);
  return H;
}

/* What a supplement row says about it now — the store for banked nutrients, else the live blood estimate. */
function estOf(S) {
  return S ? (S.store && S.store.v != null ? S.store.label + ' ' + S.store.v + S.store.unit.replace(/^%/, '%') : S.store && S.store.text ? S.store.label.replace(' (estimate)', '') + ': ' + S.store.text : S.recent || S.sp.where === 'gut' ? S.line : '') : '';
}
/* Real time: the estimates move with the clock, so they refresh every minute while Body Arch or a dose sheet is on
   screen (they were worked out once when the page drew and then sat still). Only the text changes — no redraw. */
setInterval(() => {
  if (document.hidden) return;
  if (document.body.dataset.tab === 'body') document.querySelectorAll('.mic2-main[data-k]').forEach(b => {
    const el = b.querySelector('.est'); if (!el) return;
    const t = estOf(standing(b.dataset.k)); if (t && el.textContent !== t) el.textContent = t;
  });
  const s = topSheet(), a = document.activeElement;
  if (s && s.id === 'dose' && !(a && /INPUT|TEXTAREA/.test(a.tagName) && s.el.contains(a))) s.refresh();
}, 60e3);

/* ── micros: every dose has a time; the kinetics model says what is in you now ── */
function secMicros(v) {
  const t = today(), D = v.bioDefs;
  if (!D || !D.micros || !D.micros.length) return card(`<div class="empty">Micronutrient tracking appears after the first sync.</div>`);
  const amt = (v.bio[t] || {}).micros || {}, doses = v.doses || [];
  const fmtN = n => n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : (n % 1 === 0 ? '' + n : (+n).toFixed(1));
  // What you actually take comes first: logged on 3+ different days in the last 30 (dose log or a day's total),
  // most recent first. One-offs and the ones you never take follow as slim rows — still one list.
  const last = {}, daysOf = {}, cut30 = shiftDay(t, -30);
  const saw = (k, d) => { if (!d) return; if (!last[k] || d > last[k]) last[k] = d; if (d >= cut30) (daysOf[k] = daysOf[k] || new Set()).add(d); };
  // only real logs make a supplement one you take — carried days (logic/carry.ts) do not
  const R0 = v.raw || v;
  (R0.doses || []).forEach(x => saw(x.k, String(x.at || '').slice(0, 10)));
  Object.keys(R0.bio || {}).forEach(d => { const mc = (R0.bio[d] || {}).micros || {}; Object.keys(mc).forEach(k => { if (mc[k] > 0) saw(k, d); }); });
  const order = [...(D.cats || []).flatMap(c => D.micros.filter(m => m.cat === c)), ...D.micros.filter(m => !(D.cats || []).includes(m.cat))];
  const used = order.filter(m => daysOf[m.k] && daysOf[m.k].size >= 3).sort((x, y) => (last[y.k] || '').localeCompare(last[x.k] || ''));
  const rest = order.filter(m => !used.includes(m));
  const goals = used.filter(m => !m.limit), hit = goals.filter(m => (amt[m.k] || 0) >= m.goal).length;
  let H = `<div class="sub" style="margin:-4px 2px 8px;line-height:1.45">${used.length ? hit + ' of ' + goals.length + ' you take at target today · ' : ''}the + button logs your usual dose; tap a row to change the amount or time. Amounts in blood are estimates from dose times and average kinetics (±30–50 %), not lab values.</div>`;
  const row = (m, slim) => {
    const a = amt[m.k] || 0, saf = L.microSafety(m.k, a), over = (saf && saf.level === 'over') || (m.limit && a > (m.goal || 0));
    const pct = m.limit ? (a > 0 ? 1 : 0) : Math.min(1, a / (m.goal || 1));
    const col = over ? '#ff453a' : m.c;
    const S = slim ? null : standing(m.k);
    const est = estOf(S);   // no dose, no claim
    // The quick button logs what you usually take (logic/pk.ts usualDose) — 400 µg is one tap, not sixteen of +25.
    const u = usualOf(m.k), step = u ? u.amount : (m.steps || [])[0];
    const tk = slim ? null : doses.filter(x => x.k === m.k && L.dayKey(new Date(x.at)) === t).map(x => Date.parse(x.at)).sort((a, c) => c - a)[0];
    return `<div class="mic2${slim ? ' slim' : ''}" style="--mc:${col}">
        <button class="mic2-main" data-act="dose-sheet" data-k="${m.k}" aria-label="${esc(m.name)} — log a dose and see the estimate">
          <span class="ring">${slim ? `<span class="mic2-dot">${m.icon}</span>` : ringSvg(pct, col, 44, 5.5, m.limit ? (a ? fmtN(a) : '0') : over ? '!' : a >= m.goal ? '✓' : Math.round(pct * 100))}</span>
          <span class="tx"><span class="nm">${slim ? '' : m.icon + ' '}${esc(m.name)}</span>
            <span class="amt">${slim ? (last[m.k] ? 'last ' + fmtDay(last[m.k], { day: 'numeric', month: 'short' }) + ' · ' : '') + 'goal ' + fmtN(m.goal || 0) + ' ' + esc(m.unit)
              : (m.limit ? (a ? fmtN(a) + ' ' + esc(m.unit) + ' today' : 'none today') + ' · keep at ' + fmtN(m.goal || 0) : fmtN(a) + ' / ' + fmtN(m.goal) + ' ' + esc(m.unit)) + (tk ? ' · <b class="tk">✓ ' + hm(tk) + '</b>' : '')}</span>
            ${est ? `<span class="est">${esc(est)}</span>` : ''}
            ${saf && !m.limit && a > 0 ? `<span class="warn ${saf.level}">⚠ ${esc(L.safetyLabel(saf))} · ${fmtN(saf.ul)} ${esc(saf.unit)}</span>` : ''}</span></button>
        ${step ? `<button class="mic2-add${u ? ' mine' : ''}" data-act="dose-quick" data-k="${m.k}" data-v="${step}" aria-label="Log ${u ? 'your usual ' : ''}${fmtN(step)} ${esc(m.unit)} of ${esc(m.name)} now">+${fmtN(step)}<small>${esc(m.unit)}</small></button>` : ''}</div>`;
  };
  // One list: what you take (full rows, most recent first), then everything else as slim rows.
  H += card(used.map(m => row(m, false)).join('') + (used.length && rest.length ? `<div class="mic2-sep">Rarely or never in the last 30 days</div>` : '') + rest.map(m => row(m, !!used.length)).join(''), 'tight mic-list');
  return H;
}

/* ── endocrine: a clean list; each hormone opens its day and 21-day charts (js/hormones.js) ── */
function secEndo(v) {
  const E = v.endo;
  let H = `<div class="sim slim"><span>ⓘ</span><div>Estimated from ARK's hormone model on your PC, shown in the units each blood test uses — <b>estimates, not lab results</b>. Tap a hormone for its likely range, its day hour by hour, and the last 3 weeks.</div></div>
    <button class="btn btn-tint block" style="--accent:#bf5af2;margin:0 0 12px" data-act="whatif-open">⟳ What if… — simulate a change</button>`;
  if (!E) return H + card(`<div class="empty">Nothing estimated yet. Log sleep, stress, intake or a workout and your PC's engine begins estimating.</div>`) + bloodCard(v);
  const cc = E.confidence >= 0.55 ? '#30d158' : E.confidence >= 0.3 ? '#ffb340' : '#ff6b5a';
  H += hormoneRows(v);
  H += `<div class="ehdr slim"><div><div class="v" style="color:${cc}">${Math.round(E.confidence * 100)}%</div><div class="k">Confidence</div></div>
    <div><div class="v">${E.days}d</div><div class="k">History</div></div><div><div class="v">${E.samples}</div><div class="k">Simulations</div></div></div>`;
  const next = (E.next || []).filter(n => !/^(alcohol|illness)$/i.test(n.label) && n.can);
  if (next.length) H += `<div class="eyebrow" style="margin:10px 2px 6px">Log these to sharpen the estimate</div><div class="chips" style="margin-bottom:10px">${next.map(n =>
    `<button class="chip" ${n.can ? 'data-act="ba-jump" data-sec="ba-vit"' : 'disabled'} style="height:32px;font-size:.78rem">${esc(n.label)}</button>`).join('')}</div>`;
  if ((E.derived || []).length) H += `<div class="eyebrow" style="margin:12px 2px 6px">Overall</div><div class="der2">${E.derived.map(D => {
    const col = D.invert ? (D.score >= 65 ? '#ff6b5a' : D.score >= 45 ? '#ffb340' : '#30d158') : (D.score >= 65 ? '#30d158' : D.score >= 45 ? '#ffb340' : '#ff6b5a');
    return `<div class="der" style="--dc:${D.c}"><div class="n">${D.ic} ${esc(D.name)}</div><div class="v ${D.ordinal ? 'ord' : ''}" style="color:${col}">${D.ordinal ? esc(D.label) : D.score}</div>
      ${D.ordinal ? '' : `<div class="t"><i style="width:${D.score}%;background:${col}"></i></div>`}<div class="note">${esc(D.note || '')}</div></div>`;
  }).join('')}</div>`;
  return H + bloodCard(v);
}

/* ── bloodwork: the MEASURED track (logic/src/bloodwork.ts) ──
   Lab results as the report printed them. Shown beside the estimate, never
   fed into it; ARK says only whether a value sits inside the lab's range. */
const STW = { in: 'inside your lab’s range', low: 'below your lab’s range', high: 'above your lab’s range' };
function labLine(labs, axis) {
  const m = labs.find(x => x.axis === axis); if (!m) return '';
  const L0 = m.latest, st = L.bloodStatus(L0);
  return `<div class="lab"><span class="k">LAB</span><span>${esc(L0.marker)} <b>${esc(String(L0.value))}</b> ${esc(L0.unit || '')}</span><span>· ${fmtDay(L0.date, { day: 'numeric', month: 'short', year: '2-digit' })}</span>${st ? `<span class="st-${st}">· ${STW[st]}</span>` : ''}</div>`;
}
function bloodCard(v) {
  const M = L.bloodMarkers(v.bloodwork || []);
  return `<div class="ba-h" style="margin-top:22px"><h2 style="font-size:1.05rem">🧪 Measured · bloodwork</h2><button class="link" data-act="blood-add">Add result</button></div>`
    + card(`<p class="sub" style="margin:0 0 ${M.length ? 10 : 0}px;line-height:1.5">Your lab results exactly as reported. They never change the 0–100 score; a recent one anchors that hormone's estimated level to you. ARK does not interpret them — ask your doctor what they mean.</p>
      ${M.length ? `<div class="list">${M.map(m => {
        const L0 = m.latest, st = L.bloodStatus(L0);
        return `<div class="li" style="padding-left:0;padding-right:0"><span class="tx"><div class="tt">${esc(L0.marker)}</div>
          <div class="st" style="white-space:normal"><b class="num" style="color:var(--t1);font-size:.95rem">${esc(String(L0.value))}</b> ${esc(L0.unit || '')} · ${fmtDay(L0.date, { day: 'numeric', month: 'short', year: 'numeric' })}${L0.lo != null || L0.hi != null ? ' · range ' + esc((L0.lo ?? '') + '–' + (L0.hi ?? '')) : ''}${m.series.length > 1 ? ' · ' + m.series.slice(-4).map(x => x.value).join(' → ') : ''}</div></span>
          ${st ? `<span class="tag" style="--c:${st === 'in' ? '#30d158' : '#ffb340'}">${st === 'in' ? 'in range' : st}</span>` : ''}
          <button class="circle sm" data-act="blood-del" data-id="${esc(L0.id)}" aria-label="Delete this ${esc(L0.marker)} result">${icon('trash', 15)}</button></div>`;
      }).join('')}</div>` : ''}`);
}
const BLOOD_COMMON = ['Total testosterone', 'Free testosterone', 'Estradiol', 'SHBG', 'Albumin', 'Cortisol (morning)', 'IGF-1', 'TSH', 'Total T3', 'Free T3', 'Free T4',
  'Fasting glucose', 'HbA1c', 'Fasting insulin', 'Vitamin D (25-OH)', 'Ferritin', 'Hemoglobin', 'LDL', 'HDL', 'Triglycerides', 'CRP (hs)'];
function bloodSheet() {
  openSheet({
    id: 'blood', title: 'Add a lab result',
    render: () => `<label class="field"><span>Marker</span><input class="inp" data-b="marker" list="blood-list" autocomplete="off" placeholder="e.g. Vitamin D (25-OH)">
        <datalist id="blood-list">${BLOOD_COMMON.map(m => `<option value="${m}">`).join('')}</datalist></label>
      <div class="row" style="gap:10px;align-items:flex-start">
        <label class="field" style="flex:1"><span>Value</span><input class="inp num" data-b="value" inputmode="decimal"></label>
        <label class="field" style="flex:1"><span>Unit, as printed</span><input class="inp" data-b="unit" autocomplete="off"></label></div>
      <div class="row" style="gap:10px;align-items:flex-start">
        <label class="field" style="flex:1"><span>Range low</span><input class="inp num" data-b="lo" inputmode="decimal"></label>
        <label class="field" style="flex:1"><span>Range high</span><input class="inp num" data-b="hi" inputmode="decimal"></label></div>
      <label class="field"><span>Date of the test</span><input class="inp" data-b="date" type="date" value="${today()}" max="${today()}"></label>
      <button class="btn btn-prominent block" style="--accent:#bf5af2" data-act="blood-save">Save result</button>
      <p class="sub" style="text-align:center;margin-top:12px;line-height:1.5">Copy the reference range from your report if it has one — it is the only thing a value is compared against.</p>`,
  });
  setTimeout(() => document.querySelector('[data-b="marker"]')?.focus(), 450);
}

/* ══════════════ page ══════════════ */
export function renderBodyArch() {
  const v = view();
  let H = `<header class="hdr"><div><div class="hdr-eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1 class="hdr-title">Body Arch</h1></div><div class="hdr-acts">${syncButton()}</div></header>`;
  H += `<nav class="jump" aria-label="Body Arch sections"><div class="jump-in glass">${SECTIONS.map((s, i) =>
    `<button class="${i === 0 ? 'on' : ''}" data-act="ba-jump" data-sec="${s[0]}">${s[1]}</button>`).join('')}<button class="all" data-act="ba-all">${allOpen() ? 'Fold all' : 'Open all'}</button></div></nav>`;
  if (!v.body.muscles.length) {
    return H + card(`<div class="empty">Body Arch fills in after the first sync with ARK on your PC.</div>`);
  }
  lastSecs = sections(v);
  return H + '<div class="ba-secs">' + Object.values(lastSecs).join('') + '</div>';
}

const SEC_DEFS = [
  ['ba-scan', 'Scanner', 'biomechanical matrix', secScanner],
  ['ba-vit', 'Biometric Status', 'vitals · log today', secVitals],
  ['ba-sys', 'Body Systems', 'readiness · report card · body age · muscle recovery', secSystemsAll],
  ['ba-dev', 'Body Development', 'volume · injuries · balance', secDevelop],
  ['ba-mind', 'Mental State', 'neural link', secMind],
  ['ba-mic', 'Supplements', 'what you took · what is in you', secMicros],
  ['ba-endo', 'Endocrine Estimate', '', secEndo],
];
/* ── compact page: every section is a header with a live one-line summary; tap to open ──
   The whole of Body Arch stays on one screen as headers (nothing is dropped), the Scanner starts open, the
   chips open and jump, and "All" opens everything — the old full page. A closed section is not even
   rendered, which also makes the tab cheaper. Open/closed is remembered per section. */
const baOpen = () => state.settings.baOpen || (state.settings.baOpen = { 'ba-scan': true });
/* Every section shows everything at once when open — no folds inside (Bruno, 2026-10-04: "not a tab inside a
   tab", "when I open it I want to see all of them"). The Scanner and Biometric Status start open. */
const OPEN_FIRST = new Set(['ba-scan', 'ba-vit']);
const isOpen = id => { const o = baOpen(); return id in o ? !!o[id] : OPEN_FIRST.has(id); };
const allOpen = () => SECTIONS.every(x => isOpen(x[0]));
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const SUMMARY = {
  'ba-scan': v => { const c = v.body.counts || {};
    return (c.ready ?? 0) + ' ready · ' + ((c.recovering || 0) + (c.fresh || 0)) + ' recovering'; },
  'ba-vit': v => { const b = v.bio[today()] || {};
    return 'sleep ' + (b.sleep ? fmt1(b.sleep) + ' h' : '—') + ' · protein ' + (b.prot ? Math.round(b.prot) + ' g' : '—') + ' · water ' + (b.water ? fmt1(b.water) + ' L' : '—'); },
  'ba-sys': v => { const R = systemsNow(v), r = (v.readiness || {})[today()]; const g = R.rows.filter(r => r.grade === 'good').length, w = R.rows.filter(r => r.grade === 'watch' || r.grade === 'poor').length;
    return 'readiness ' + (r ?? '—') + ' · ' + g + ' good · ' + w + ' to watch' + (R.age.known ? ' · body age ' + R.age.bodyAge : ''); },
  'ba-dev': v => { const under = v.body.muscles.filter(m => m.vol && (m.vol.zone === 'under' || m.vol.zone === 'none')).length;
    const inj = Object.keys(L.activeInjuries(v.injuries || [], today())).length, F = fatigueNow(v);
    return plural(under, 'muscle') + ' under range · fatigue: ' + F.title.toLowerCase() + (inj ? ' · ' + plural(inj, 'injury').replace('injurys', 'injuries') : ''); },
  'ba-prof': v => { const w = latestWeight(v), p = v.profile || {}; return [w ? fmt1(w) + ' kg' : null, p.height ? p.height + ' cm' : null, p.bodyfat ? p.bodyfat + ' % fat' : null].filter(Boolean).join(' · ') || 'set up your profile'; },
  'ba-mind': v => { const b = v.bio[today()] || {}; return b.energy != null || b.mood != null ? 'energy ' + (b.energy ?? '—') + '/10 · stress ' + (b.stress ?? '—') + '/10' : 'not checked in today'; },
  'ba-mic': v => { const D = v.bioDefs; if (!D || !D.micros) return '—'; const amt = (v.bio[today()] || {}).micros || {}, g = D.micros.filter(m => !m.limit);
    return g.filter(m => (amt[m.k] || 0) >= m.goal).length + ' of ' + g.length + ' at target today'; },
  'ba-endo': v => { const E = v.endo; if (!E) return 'not estimated yet'; const a = (E.axes || []).find(x => x.k === 'testosterone');
    return Math.round(E.confidence * 100) + ' % confidence' + (a ? ' · testosterone ' + a.score : ''); },
};
/* Section cards (2026-10-24): each folded section is a card with its own colour and icon; the summary shows one part
   per line. Open, the header is the plain row it always was. */
const SEC_LOOK = { 'ba-scan': ['hex', '#40c8e0'], 'ba-vit': ['heart', '#30d158'], 'ba-sys': ['chart', '#64d2ff'], 'ba-dev': ['dumbbell', '#ff9f0a'],
  'ba-mind': ['brain', '#bf5af2'], 'ba-mic': ['pill', '#ffd60a'], 'ba-endo': ['bolt', '#ff375f'] };
function sections(v) {
  const out = {}, open = SEC_DEFS.map(d => isOpen(d[0])), fill = {};
  // A card left alone at the end of a row stretches to fill it — two cards a row on a phone (w2), three on an iPad
  // (w3a: one left over, w3b: two). Open sections always take the full width.
  for (let i = 0; i < SEC_DEFS.length;) {
    if (open[i]) { i++; continue; }
    let j = i; while (j < SEC_DEFS.length && !open[j]) j++;
    const run = SEC_DEFS.slice(i, j).map(d => d[0]), r3 = run.length % 3;
    if (run.length % 2) fill[run[run.length - 1]] = ' w2';
    run.slice(run.length - r3).forEach(id => { fill[id] = (fill[id] || '') + (r3 === 1 ? ' w3a' : ' w3b'); });
    i = j;
  }
  SEC_DEFS.forEach(([id, title, k, fn], n) => {
    const on = open[n];
    let sum = ''; try { sum = SUMMARY[id] ? SUMMARY[id](v) : k; } catch (e) { sum = k; }
    const look = SEC_LOOK[id] || ['hex', '#40c8e0'];
    const sub = on ? esc(k) : String(sum || '').split(' · ').map(x => '<i>' + esc(x) + '</i>').join('');
    const hd = `<button class="ba-hd" data-act="ba-toggle" data-sec="${id}" aria-expanded="${on}" style="--ac:${look[1]}">
      <span class="ba-ic">${icon(look[0], 19)}</span><span class="t"><h2>${title}</h2><span class="s">${sub}</span></span>${icon('chev', 18)}</button>`;
    out[id] = `<section class="ba-sec${on ? ' open' : fill[id] || ''}" id="${id}">${hd}
      ${on ? `<div class="ba-bd">${fn(v)}</div>` : ''}</section>`;
  });
  return out;
}
let lastSecs = null;
/**
 * Update Body Arch in place: rebuild each section's markup (cheap) but only
 * swap the sections whose markup changed. Replacing the whole ~11,000 px page
 * cost ~40 ms of DOM and layout on every tap; one section is a few ms.
 * Returns false when a full render is needed instead.
 */
export function patchBodyArch() {
  const v = view();
  if (!lastSecs || !document.getElementById('ba-scan') || !v.body.muscles.length) return false;
  const next = sections(v);
  // Keep the page still. Open sections are content-visibility:auto, and a freshly built one has no remembered
  // height — off screen it would count as the 900 px placeholder and throw the page up or down on every tap
  // (+½ h sleep, a vitamin). So each rebuilt section keeps its old height, and the control you tapped (else the
  // section at the top of the screen) is put back exactly where it was.
  const anchor = keepAnchor();
  let scan = false;
  Object.keys(next).forEach(id => {
    if (next[id] === lastSecs[id]) return;
    const el = document.getElementById(id);
    if (!el) return;
    const bd = el.querySelector(':scope > .ba-bd'), h = bd ? Math.round(bd.getBoundingClientRect().height) : 0;
    el.outerHTML = next[id];
    const nb = h ? document.querySelector('#' + id + ' > .ba-bd') : null;
    if (nb) nb.style.containIntrinsicSize = 'auto ' + h + 'px';
    if (id === 'ba-scan') scan = true;
  });
  lastSecs = next;
  const lbl = allOpen() ? 'Fold all' : 'Open all';
  document.querySelectorAll('.jump .all').forEach(b => { b.textContent = lbl; });
  if (scan) mountFigure(); else paint();
  holdAnchor(anchor);
  return true;
}
/* What you last tapped in Body Arch, as a selector that finds its rebuilt copy. */
let lastTap = null, lastTapAt = 0;
document.addEventListener('pointerdown', e => {
  const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
  if (!b || !b.closest('.ba-sec')) return;
  lastTap = '[data-act="' + CSS.escape(b.dataset.act) + '"]' + ['f', 'k', 'v', 'd', 'slug', 'sec', 'key', 'a', 'n'].filter(k => b.dataset[k] != null)
    .map(k => '[data-' + k + '="' + CSS.escape(b.dataset[k]) + '"]').join('');
  lastTapAt = Date.now();
}, { capture: true, passive: true });
function keepAnchor() {
  const sel = lastTap && Date.now() - lastTapAt < 4000 ? lastTap : null, el = sel ? document.querySelector('.ba-sec ' + sel) : null;
  if (el) return { sel: '.ba-sec ' + sel, top: el.getBoundingClientRect().top };
  const sec = [...document.querySelectorAll('.ba-sec')].find(s => s.getBoundingClientRect().bottom > 90);
  return sec ? { sel: '#' + sec.id, top: sec.getBoundingClientRect().top } : null;
}
function restoreAnchor(a) {
  if (!a) return;
  const el = document.querySelector(a.sel); if (!el) return;
  const d = el.getBoundingClientRect().top - a.top;
  if (Math.abs(d) > 1) window.scrollTo({ top: window.scrollY + d, behavior: 'instant' });
}
/* Hold it there for ~1 s — now, before each paint while sections resize (the figure and rings settle a little
   later), and on a few timers. Corrections are instant; your own touch or scroll lets go at once. */
let hold = null;
function holdAnchor(a) {
  if (hold) hold.stop();
  if (!a) return;
  const H = { done: false, timers: [], ro: null };
  const off = () => H.stop();
  H.stop = () => { if (H.done) return; H.done = true; H.timers.forEach(clearTimeout); if (H.ro) H.ro.disconnect(); ['touchstart', 'wheel'].forEach(t => window.removeEventListener(t, off, true)); };
  ['touchstart', 'wheel'].forEach(t => window.addEventListener(t, off, { capture: true, passive: true }));
  const fix = () => { if (!H.done) restoreAnchor(a); };
  fix();
  requestAnimationFrame(() => requestAnimationFrame(fix));
  [120, 300, 600, 950].forEach(ms => H.timers.push(setTimeout(fix, ms)));
  H.timers.push(setTimeout(() => H.stop(), 1000));
  try { if (window.ResizeObserver) { H.ro = new ResizeObserver(fix); document.querySelectorAll('.ba-sec').forEach(s => H.ro.observe(s)); } } catch (e) { /* old Safari */ }
  hold = H;
}

/* keep the jump chips in step with where you are */
let watching = false;
let lastJump = null;
function watchSections() {
  if (watching) return;
  watching = true;
  let raf = 0;
  window.addEventListener('scroll', () => {
    if (document.body.dataset.tab !== 'body') return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const y = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t')) || 0) + 90;
      let cur = SECTIONS[0][0];
      SECTIONS.forEach(s => { const el = document.getElementById(s[0]); if (el && el.getBoundingClientRect().top <= y) cur = s[0]; });
      document.querySelectorAll('.jump button').forEach(b => b.classList.toggle('on', b.dataset.sec === cur));
      // keep the section you are in visible on the bar (it scrolls sideways on a phone)
      if (cur !== lastJump) {
        lastJump = cur;
        const on = document.querySelector('.jump button.on'), bar = on && on.closest('.jump');
        if (bar) { const r = on.getBoundingClientRect(), br = bar.getBoundingClientRect();
          if (r.left < br.left + 12 || r.right > br.right - 12) bar.scrollTo({ left: bar.scrollLeft + (r.left - br.left) - (br.width - r.width) / 2, behavior: 'smooth' }); }
      }
    });
  }, { passive: true });
}

/* ══════════════ muscle sheet ══════════════ */
function muscleSheet(slug) {
  ui.sel = slug; paint();
  openSheet({
    id: 'muscle', title: (window.ARK_MNAME || {})[slug] || slug,
    onClose: () => { ui.sel = null; paint(); },
    render: () => {
      const v = view(), m = bySlug(v)[slug] || {}, bio = (window.ARK_MUSCLE_BIO || {})[slug] || {};
      const met = m.metric || {}, pinned = !!(v.body.pins || {})[slug];
      const st = STATE_LBL[m.state] || STATE_LBL.untouched;
      const t = today();
      const days = [6, 5, 4, 3, 2, 1, 0].map(i => shiftDay(t, -i));
      const hits = new Set(v.workouts.filter(w => (w.slugs || []).includes(slug)).map(w => w.date));
      const vol = m.vol30 || 0;
      const T = tissueNow(), tm = T.muscles[slug] || null;
      const tens = tm ? tm.tendons.map(k => T.tendons[k]).filter(Boolean) : [];
      const TST = { spike: ['Load spike', '#ff453a'], building: ['Building', '#40c8e0'], steady: ['Steady', '#30d158'], detraining: ['Detraining', '#ffb340'], untrained: ['Untrained', 'rgba(235,240,245,.5)'] };
      const zc = !tm || tm.weekSets < 6 ? '#ffb340' : tm.weekSets <= 20 ? '#30d158' : '#ff9f0a';
      const tile = (c, k, val, unit, sub, bar) => `<div class="mt" style="--c:${c}"><div class="k">${k}</div><div class="v num">${val}<small>${unit}</small></div>
        ${bar != null ? `<div class="b"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>` : ''}<div class="s">${sub}</div></div>`;
      const tCap = tens.length ? Math.min(...tens.map(x => x.capacity)) : null;
      return `${bio.lat ? `<div class="ms-lat">${esc(bio.lat)}</div>` : ''}
      <div class="ms-state"><span class="tag" style="--c:${st[1]}">${st[0].toUpperCase()}</span>
        ${m.group ? `<span class="tag">${esc(GROUPS[m.group] ? GROUPS[m.group][0] : m.group)}</span>` : ''}
        ${bio.rec ? `<span class="tag">Recovers in ${esc(bio.rec)}</span>` : ''}${pinned ? '<span class="tag" style="--c:#bf5af2">Pinned</span>' : ''}</div>
      <div class="mtiles">
        <button class="mt-btn" data-act="str-why" data-slug="${slug}" aria-label="How strength is estimated">${tm && tm.strength
          ? tile('#30d158', 'Strength', tm.strength.score, '/100', esc(tm.strength.level) + ' · ' + tm.strength.rel + '× body weight', tm.strength.score)
          : tile('#30d158', 'Strength', '—', '', 'log a main lift for an estimate', null)}</button>
        ${tile('#40c8e0', 'Mobility', m.mobility > 0 ? fmt1(m.mobility) : '—', m.mobility > 0 ? '/10' : '', 'estimated · training + mobility work', m.mobility > 0 ? m.mobility * 10 : null)}
        <button class="mt-btn" data-act="tendon-why" data-slug="${slug}" aria-label="How tendon capacity is estimated">${tile(tCap === null ? 'rgba(235,240,245,.5)' : tCap >= 65 ? '#30d158' : tCap >= 52 ? '#40c8e0' : '#ffb340', 'Tendon capacity', tCap === null ? '—' : tCap, tCap === null ? '' : '/100', tens.length ? (tCap <= 51 ? 'untrained baseline · ' : '') + esc(tens.map(x => x.name.replace(/ tendon$/i, '')).join(' · ')) : 'no tendon mapped', tCap)}</button>
        <button class="mt-btn" data-act="ar-why" data-slug="${slug}" aria-label="Why this androgen-receptor estimate">${tile('#bf5af2', 'AR sensitivity', tm ? tm.ar : '—', tm ? '/100' : '', tm && tm.arDrivers[0] ? (tm.arDrivers[0].d > 0 ? '▲ ' : '▼ ') + esc(tm.arDrivers[0].label) : 'estimate · tap for why', tm ? tm.ar : null)}</button>
        ${(() => { const V = volOf(v, slug, m); return tile(V.color, 'Weekly volume', fmt1(m.weekSets || 0), ' / ' + V.mavLo + '–' + V.mavHi, esc(V.label), V.mrv ? (m.weekSets || 0) / V.mrv * 100 : null); })()}
        ${(() => { const R = recOf(v, slug, m); return R && R.recNow != null ? tile(st[1], 'Recovery', Math.round(R.recNow), '%', R.readyIn ? 'fully back in ~' + R.readyIn + ' h' : 'fully back · ' + ago(m.hoursSince || 0), R.recNow) : tile(st[1], 'Recovery', m.hoursSince == null ? '—' : ago(m.hoursSince).replace(' ago', ''), '', 'since last trained · ' + st[0].toLowerCase(), null); })()}
      </div>
      ${tm && tm.lag ? `<div class="target hint" style="margin:10px 0 0">${icon('bolt', 16)}<div><b>Strength is ahead of the tendons</b><span>Muscle adapts in weeks, tendon in months. Add load slowly here and keep some slow, heavy reps; collagen + vitamin C before training may help.</span></div></div>` : ''}
      ${tens.length ? `<div class="grp-h" style="margin-top:16px">Tendons & joints</div><section class="list frost">${tens.map(x => `<div class="li"><span class="tx"><div class="tt">${esc(x.name)}</div>
        <div class="st"><span style="color:${TST[x.status][1]}">${TST[x.status][0]}</span>${x.acwr !== null ? ' · load ratio ' + x.acwr : ''}${x.collagenSessions ? ' · ' + x.collagenSessions + '× collagen + C' : ''}</div></span>
        <b class="num">${x.capacity}</b></div>`).join('')}</section>` : ''}
      ${injBlock(v, slug)}
      ${analysisBlock(v, slug, m)}
      ${liftsBlock(v, slug)}
      <div class="hist7" style="margin-top:14px">${days.map(k => `<span class="${hits.has(k) ? 'hit' : ''} ${k === t ? 't' : ''}"><i></i>${fmtDay(k, { weekday: 'narrow' })}</span>`).join('')}</div>
      ${soreBlock(v, slug)}
      ${bio.act ? `<div class="grp-h" style="margin-top:16px">Anatomy</div><section class="card frost tight">${bio.ft != null ? fibreBar(bio.ft) : ''}<dl class="anat">
        <dt>Action</dt><dd>${esc(bio.act)}</dd>${bio.org ? `<dt>Origin</dt><dd>${esc(bio.org)}</dd>` : ''}${bio.ins ? `<dt>Insertion</dt><dd>${esc(bio.ins)}</dd>` : ''}
        ${bio.ant ? `<dt>Antagonist</dt><dd>${esc(bio.ant)}</dd>` : ''}</dl>
        ${bio.note ? `<p style="font-size:.8rem;color:var(--t2)">${esc(bio.note)}</p>` : ''}</section>` : ''}
      ${physioBlock(v, slug)}
      <p class="sub" style="line-height:1.45;margin:12px 0 0">Tendon capacity and AR sensitivity are model estimates from the sets you logged and each exercise's loading, adjusted by sleep, protein and the hormone estimate — not measurements.</p>
      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn btn-prominent" style="flex:1;--accent:#ff9f0a" data-act="train-slug" data-slug="${slug}">${icon('dumbbell', 17)} Train ${esc(m.name || '')}</button>
        <button class="btn btn-glass" data-act="ms-pin" data-slug="${slug}">${pinned ? 'Unpin' : 'Pin'}</button></div>`;
    },
  });
}

/* ── Analysis: one muscle in charts (logic/muscle.ts + logic/charts.ts — the same charts the PC draws) ── */
const CH_PAL = { fg: 'rgba(235,240,245,.92)', dim: 'rgba(235,240,245,.5)', grid: 'rgba(255,255,255,.08)', accent: '#40c8e0', band: 'rgba(48,209,88,.14)', warn: '#ff9f0a', good: '#30d158' };
function analysisBlock(v, slug, m) {
  const t = today(), p = v.profile || {}, w = latestWeight(v) || (+p.weight || null), age = L.specimen(p).age;
  const A = L.muscleAnalytics({ sessions: v.workouts || [], slug, today: t, bodyweight: w, sex: p.sex, antagonists: L.ANTAGONISTS });
  const V = m.vol || null, S = L.muscleStory(v.workouts || [], slug, t, v.injuries || [], 12, Number(w) || null);
  const blk = (h, body, note) => body ? `<div class="ana frost"><div class="ana-h">${h}</div>${body}${note ? `<p class="sub ana-n">${note}</p>` : ''}</div>` : '';
  let H = `<div class="grp-h" style="margin-top:16px">Analysis</div>`;
  const R = recOf(v, slug, m), win = m.recWindow || { lo: 48, hi: 72 }, SE = soreOf(v, slug);
  if (R && R.pts.length) H += blk('Recovery & soreness since the last session', L.svgRecovery(R.pts, R.lastH, win, CH_PAL, 320, 170),
    `Line = strength back after the session — ${Math.round(R.recNow)} % now${R.readyIn ? ', within 5 % of fresh in ~' + R.readyIn + ' h for this many sets' : ', back to fresh'}. Shaded = soreness, now ${SE.label.toLowerCase()} — it often outlasts the strength dip. Green band = the textbook recovery window for this muscle.`);
  H += blk('Hard sets per week · 12 weeks', L.svgWeeklySets(A.weeks, V ? { mev: V.mev, mavLo: V.mavLo, mavHi: V.mavHi, mrv: V.mrv } : null, CH_PAL),
    esc(S.lines.join(' ')) + ' Green band = where weekly sets grow it; dashed = the most you can recover from.');
  A.lifts.forEach(lf => {
    const lv = lf.levels.filter(x => lf.best && x.kg <= lf.best).pop();
    H += blk(esc(lf.n) + ' · best est. 1RM per session', L.svgLiftTrend(lf, t, CH_PAL),
      `Dashed lines = population standards for this lift at your ${w ? Math.round(w) + ' kg' : 'body weight'}${lf.bw ? ' (body weight included)' : ''}. Latest session ${lf.last || '—'} kg${lf.rel ? ' (' + lf.rel + '×)' : ''} · best in 6 months ${lf.best} kg${lv ? ' — ' + lv.label : ''}.`);
  });
  if (!A.lifts.length) H += blk('Strength', ' ', 'No standard lift for this muscle in the last 6 months — strength is not measured here.');
  H += blk('What trained it · 8 weeks', L.svgBars(A.exercises.map(x => ({ label: x.n, v: x.sets })), CH_PAL, 320, ' sets'), 'Hard sets, weighted by how much each exercise works this muscle.');
  if (A.balance && A.balance.mine + A.balance.theirs > 0) H += blk(esc(A.balance.name) + ' · 8 weeks', L.svgSplit({ label: 'this side', v: A.balance.mine }, { label: 'opposite', v: A.balance.theirs }, CH_PAL),
    'Hard sets a week on each side. ' + (A.balance.ratio != null && (A.balance.ratio > 65 || A.balance.ratio < 35) ? 'Lopsided — the stronger side tends to pull joints out of line.' : 'Within a normal spread.'));
  const ME = L.mobilityEstimate(L.setsPerWeekAll(v.workouts || [], t, 56)[slug] || 0, v.body.mobilityDays28 || 0, age);
  H += blk('Mobility · estimated ' + ME.score + ' / 10', `<div class="ana-rows"><div><span>Untrained adult</span><b class="num">5.0</b></div>${ME.parts.map(x => `<div><span>${esc(x.label)}</span><b class="num">${x.d > 0 ? '+' : ''}${x.d}</b></div>`).join('')}</div>`,
    'Strength training through a full range improved range of motion as much as stretching (Afonso 2021) — an exposure estimate, not a measured angle.');
  return H;
}
/* Soreness per muscle from your sessions (DOMS time course × dose × repeated-bout effect, logic/muscle.ts), cached per render. */
let soreCache = null, soreFor = null;
function soreAll(v) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + Math.floor(Date.now() / 6e5);
  if (soreFor !== k) { soreCache = L.sorenessByMuscle(v.workouts || [], Object.keys(window.ARK_MNAME || {}), Date.now()); soreFor = k; }
  return soreCache;
}
function soreOf(v, slug) { return soreAll(v)[slug] || { v: 0, level: 0, label: 'None', bouts: [] }; }
function recOf(v, slug, m) { const SE = soreOf(v, slug); return SE.bouts.length ? L.recoveryCurve(SE.bouts, (m && m.recWindow) || { lo: 48, hi: 72 }, Date.now()) : null; }
function soreBlock(v, slug) {
  const SE = soreOf(v, slug), lb = SE.bouts.slice().sort((a, b) => b.t - a.t)[0];
  return `<div class="blk"><div class="blk-h"><span class="eyebrow">Soreness · estimated</span><span class="val" style="color:${SORE_COLORS[SE.level]}">${SE.label}</span></div>
    <div class="b sorebar"><i style="width:${Math.round(Math.min(1, SE.v / 3.5) * 100)}%;background:${SORE_COLORS[Math.max(1, SE.level)]}"></i></div>
    <p>${lb ? `Last session ${Math.max(0, Math.round((Date.now() - lb.t) / 3600e3))} h ago: ${lb.sets} hard sets here; you average ${lb.usual} a week on it, so it is ${lb.usual >= 6 ? 'used to the work' : lb.usual >= 1 ? 'only partly used to it' : 'not used to it'}. Soreness peaks 1–3 days after a session and is mostly gone by day 5–7 (Cheung 2003); work a muscle is used to hurts far less (repeated-bout effect).` : 'Nothing in the last 10 days that would make it sore.'} Injuries are logged separately.</p></div>`;
}
/* Physiology as graphs: size vs training share, what moves receptor sensitivity. */
function physioBlock(v, slug) {
  const T = tissueNow(), tm = T.muscles[slug] || null, per = L.setsPerWeekAll(v.workouts || [], today(), 56), SV = L.sizeVsTraining(slug, per, L.MUSCLE_MASS);
  const blk = (h, body, note) => body ? `<div class="ana frost"><div class="ana-h">${h}</div>${body}${note ? `<p class="sub ana-n">${note}</p>` : ''}</div>` : '';
  let H = '';
  if (SV.mass > 0) H += blk('Size vs training · 8 weeks', L.svgBars([{ label: 'Share of your muscle mass', v: SV.mass }, { label: 'Share of your hard sets', v: SV.train }], CH_PAL, 320, ' %'),
    SV.ratio == null ? 'No training logged in 8 weeks.' : SV.ratio >= 1.5 ? 'Trained ' + SV.ratio + '× its size — it gets more than its share.' : SV.ratio <= 0.5 ? 'Trained at ' + SV.ratio + '× its size — under-served for how big it is.' : 'Trained roughly in proportion to its size (' + SV.ratio + '×).');
  if (tm && tm.arDrivers && tm.arDrivers.length) H += blk('Receptor sensitivity · ' + tm.ar + ' / 100 · what moves it', L.svgDiverge(tm.arDrivers.slice(0, 6).map(x => ({ label: x.label, v: x.d })), CH_PAL, 320),
    'How strongly this muscle answers testosterone, from receptor density by region and months of training (Kadi 2000; Ahtiainen 2011) — a model, not a biopsy.');
  return H;
}
function fibreBar(ft) {
  const st = 100 - ft;
  return `<div class="ana-h" style="margin:2px 0 6px">Fibre type · ${ft >= 58 ? 'fast-twitch bias' : ft <= 42 ? 'slow-twitch bias' : 'mixed'}</div>
    <div class="fibre"><i style="width:${st}%;background:#40c8e0"></i><i style="width:${ft}%;background:#ff9f0a"></i></div>
    <div class="row" style="justify-content:space-between;font-size:.72rem;color:var(--t2);margin:4px 0 8px"><span>slow ${st} %</span><span>${ft} % fast</span></div>`;
}

/** How a muscle's strength or its tendons' capacity was estimated (logic/tissue.ts). */
function whySheet(slug, kind) {
  const nm = (window.ARK_MNAME || {})[slug] || slug;
  openSheet({
    id: 'why', title: (kind === 'strength' ? 'Strength · ' : 'Tendons · ') + nm,
    render: () => {
      const T = tissueNow(), m = T.muscles[slug];
      if (!m) return '<div class="empty">No estimate for this muscle.</div>';
      if (kind === 'strength') {
        const s = m.strength;
        if (!s) return `<p style="line-height:1.5;color:var(--t2)">No estimate yet. It needs a logged set of a main lift for ${esc(nm)} (bench, squat, deadlift, rows, pull-ups, presses, curls…) and your body weight.</p>`;
        return `<div class="row" style="gap:14px;margin-bottom:12px"><div class="reg-dot" style="--rc:#30d158"><b class="num">${s.score}</b></div>
          <div style="flex:1"><b style="font-size:1.1rem">${esc(s.level)}</b><div class="sub">${s.rel}× body weight on your best lift for it</div></div></div>
          <div class="grp-h">From your lifts</div><section class="list frost">${s.drivers.map(x => `<div class="li"><span class="tx"><div class="tt" style="white-space:normal">${esc(x.label)}</div></span></div>`).join('')}</section>
          <div class="grp-h">The scale</div><section class="card frost tight lvls">${[['Beginner', '0.5×'], ['Novice', '0.75×'], ['Intermediate', '1×'], ['Advanced', '1.4×'], ['Elite', '1.8×']].map(([l, r]) => `<div class="${l === s.level ? 'on' : ''}"><b>${l}</b><span>${r} the standard</span></div>`).join('')}</section>
          <p class="sub" style="line-height:1.5;margin-top:12px">Your best estimated 1-rep max (Brzycki up to 10 reps, Epley above, from sets of up to 20 reps) divided by body weight, compared with population lifting standards for that movement — e.g. an intermediate man benches about his body weight, squats 1.5× and deadlifts about 1.9×; women's standards are ~72 % (upper body) and ~82 % (lower body) of those. Strength holds for ~4 weeks without training, then fades slowly (about −6 % by 8 weeks, −11 % by 12). Dumbbells count per hand.</p>`;
      }
      const ts = m.tendons.map(k => T.tendons[k]).filter(Boolean);
      if (!ts.length) return '<div class="empty">No tendon is mapped to this muscle.</div>';
      const stc = { spike: ['Load spike', '#ff453a'], building: ['Building', '#40c8e0'], steady: ['Steady', '#30d158'], detraining: ['Detraining', '#ffb340'], untrained: ['Untrained', 'rgba(235,240,245,.5)'] };
      return ts.map(t => `<section class="card frost tight" style="margin-bottom:10px"><div class="row" style="gap:12px"><b style="flex:1">${esc(t.name)}</b>
          <span class="tag" style="--c:${stc[t.status][1]}">${stc[t.status][0]}</span><b class="num" style="font-size:1.3rem">${t.capacity}</b></div>
          <div class="sub" style="margin:4px 0 6px">${t.heavyPerWeek ? 'Heavy loading ≈ ' + t.heavyPerWeek + ' per week lately' : 'No heavy loading in the last weeks'}${t.acwr !== null ? ' · load ratio ' + t.acwr : ''}</div>
          ${t.drivers.map(x => `<div class="hd"><span style="color:${x.d >= 0 ? '#30d158' : '#ff6b5a'}">●</span><span>${esc(x.label)}${x.d ? ` <b class="num">${x.d > 0 ? '+' : ''}${x.d}${/build speed/.test(x.label) ? ' %' : ''}</b>` : ''}</span></div>`).join('')}</section>`).join('')
        + `<p class="sub" style="line-height:1.5">50 = an untrained adult. Tendons stiffen and tolerate more load after months of <b>heavy</b> work — sets near your best, which strain the tendon most (Bohm 2015 meta-analysis); light sets change them little. It builds with a ~2-month time constant and fades over ~4 months (Magnusson & Kjær 2019). Sleep, protein, age and collagen + vitamin C before training (Shaw 2017) change how fast. Muscle adapts faster — when strength runs well ahead, ramp load gradually.</p>`;
    },
  });
}

/** What sets a muscle's androgen-receptor estimate (logic/tissue.ts). */
function arSheet(slug) {
  openSheet({
    id: 'ar', title: 'AR sensitivity · ' + ((window.ARK_MNAME || {})[slug] || slug),
    render: () => {
      const m = tissueNow().muscles[slug]; if (!m) return '<div class="empty">No estimate for this muscle.</div>';
      return `<div class="row" style="gap:14px;margin-bottom:12px"><div class="reg-dot" style="--rc:#bf5af2"><b class="num">${m.ar}</b></div>
        <p style="flex:1;margin:0;line-height:1.45;color:var(--t2)">How strongly this muscle can respond to testosterone, relative to an untrained thigh muscle at average hormones (50). An estimate from your training and the hormone model — measuring it needs a muscle biopsy.</p></div>
        <div class="grp-h">What sets it</div><section class="list frost">${m.arDrivers.map(x => `<div class="li"><span class="tx"><div class="tt">${esc(x.label)}</div></span>
          <b class="num" style="color:${x.d > 0 ? '#30d158' : '#ff6b5a'}">${x.d > 0 ? '+' : ''}${x.d}</b></div>`).join('') || '<div class="li"><span class="tx"><div class="tt">Nothing moves it from baseline yet</div></span></div>'}</section>
        <p class="sub" style="line-height:1.5;margin-top:12px">Based on: more receptors in neck and shoulder muscles than in the thigh (Kadi 2000); receptor content rising over months of training (Ahtiainen 2011) and 24–48 h after a hard session (Willoughby 2004); androgens stabilising and cortisol suppressing the receptor. Receptor content, more than blood testosterone, tracked muscle growth in trained men (Mitchell 2013).</p>`;
    },
  });
}

/* ══════════════ profile editor ══════════════ */
let pDraft = null;
function profileSheet(k) {
  const f = PFIELDS.find(x => x[0] === k); if (!f) return;
  const v = view();
  pDraft = v.profile[k] ?? (k === 'birthday' ? '' : '');
  const range = { height: [100, 250, 1], bodyfat: [2, 60, 0.5], vo2max: [10, 100, 1], goalWeight: [30, 250, 0.5], priorWorkouts: [0, 100000, 10] }[k];
  openSheet({
    id: 'profile', title: f[1],
    render: () => k === 'birthday'
      ? `<label class="field"><span>Date of birth</span><input class="inp" type="date" max="${today()}" value="${esc(pDraft || '')}" data-prof-input></label>
         <button class="btn btn-prominent block" data-act="prof-save" data-k="${k}">Save</button>`
      : `<div style="text-align:center;margin:8px 0 6px"><input class="inp num" type="number" inputmode="decimal" step="${range[2]}" min="${range[0]}" max="${range[1]}"
           value="${pDraft === '' || pDraft == null ? '' : pDraft}" placeholder="—" data-prof-input style="text-align:center;font-size:2rem;height:70px;font-weight:700"></div>
         <div class="sub" style="text-align:center;margin-bottom:16px">${esc(f[2] || '')}${f[2] ? ' · ' : ''}${range[0]}–${range[1].toLocaleString()}</div>
         <button class="btn btn-prominent block" data-act="prof-save" data-k="${k}">Save</button>
         ${k === 'priorWorkouts' ? '<p class="sub" style="margin-top:12px;line-height:1.45;text-align:center">Sessions you did before you started logging in ARK. Shown separately from logged ones.</p>' : ''}`,
  });
  setTimeout(() => document.querySelector('[data-prof-input]')?.focus(), 450);
}

/* ══════════════ body development (logic/src/physique.ts) ══════════════
   Weekly sets against each muscle's landmarks, injuries that last until cleared, the tape (Navy body fat +
   recomposition trend) and strength balance between your own lifts. The PC's body state carries `vol`;
   a muscle it has not re-ranked yet falls back to the same maths here. */
const volOf = (v, slug, m) => (m && m.vol) || L.volumePlan(slug, (m && m.weekSets) || 0);
const injNow = v => L.activeInjuries(v.injuries || [], today());
const SEV_C = ['', '#ffd60a', '#ff9f0a', '#ff453a'];
const mName = s => (window.ARK_MNAME || {})[s] || s;

function injBlock(v, slug) {
  const j = injNow(v)[slug];
  if (!j) return `<button class="btn btn-glass block" style="margin-top:12px" data-act="inj-open" data-slug="${slug}">${icon('plus', 16)} Log an injury here</button>`;
  return `<div class="target hint${j.sev >= 2 ? " sore" : ""}" style="margin:12px 0 0" data-act="inj-open" data-id="${esc(j.id)}" role="button">
    ${icon('bolt', 16)}<div><b>${L.INJURY_SEV[j.sev]} ${esc((L.INJURY_KINDS[j.kind] || j.kind).toLowerCase())} · day ${j.days + 1}${j.side && j.side !== 'both' ? ' · ' + (j.side === 'L' ? 'left' : 'right') : ''}</b>
    <span>${esc(j.advice)}${j.note ? '<br>' + esc(j.note) : ''}</span></div></div>`;
}

function secDevelop(v) {
  const inj = injNow(v), by = bySlug(v);
  let H = '';
  /* weekly sets vs range */
  const notes = new Set();
  const keys = Object.keys(L.VOLUME_LANDMARKS).filter(s => by[s]);
  const rows = [...keys.filter(s => (by[s].weekSets || 0) > 0), ...keys.filter(s => !((by[s].weekSets || 0) > 0))].map(s => {
    const m = by[s], V = volOf(v, s, m); (V.notes || []).forEach(n => notes.add(n));
    const top = Math.max(V.mrv * 1.15, m.weekSets || 0, 1), pc = x => Math.min(100, x / top * 100).toFixed(1) + '%';
    return `<button class="dv-r${(m.weekSets || 0) > 0 ? '' : ' idle'}" data-act="ba-muscle" data-slug="${s}"><span class="n">${esc(m.name || mName(s))}${inj[s] ? ` <b style="color:${SEV_C[inj[s].sev]}">✚</b>` : ''}</span>
      <span class="dv-t"><i class="band" style="left:${pc(V.mavLo)};width:calc(${pc(V.mavHi)} - ${pc(V.mavLo)})"></i><i class="fill" style="width:${pc(m.weekSets || 0)};background:${V.color}"></i><i class="tick" style="left:${pc(V.mrv)}"></i></span>
      <span class="v num"><b>${fmt1(m.weekSets || 0)}</b>/${V.mavLo}–${V.mavHi}</span></button>`;
  }).join('');
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Weekly sets vs your range</h2><span class="k">last 7 days</span></div>`
    + card(`<div class="dv-vol">${rows}</div>
      <div class="fig-legend" style="margin-top:10px">${['under', 'low', 'optimal', 'high', 'over'].map(k => `<span><i style="background:${L.VOLUME_ZONE[k].color}"></i>${L.VOLUME_ZONE[k].label.replace(/ —.*/, '')}</span>`).join('')}</div>
      <p class="sub" style="line-height:1.45;margin:8px 0 0">Green band = productive range, red tick = the most you can recover from${notes.size ? ' (now: ' + esc([...notes].join(' · ').toLowerCase()) + ')' : ''}. Practitioner landmarks built on the dose–response research — guides, not measurements.</p>`);
  H += fatigueCard(v);
  /* injuries */
  const open = (v.injuries || []).filter(j => !j.cleared);
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Injuries</h2><span class="k">until you clear them</span></div>`
    + (open.length ? `<section class="list frost">${open.map(j => { const a = inj[j.slug] && inj[j.slug].id === j.id ? inj[j.slug] : L.activeInjuries([j], today())[j.slug];
      return `<button class="li" data-act="inj-open" data-id="${esc(j.id)}" style="--c:${SEV_C[j.sev]}"><span class="ic">${icon('bolt', 17)}</span><span class="tx">
        <div class="tt">${esc(mName(j.slug))} · ${L.INJURY_SEV[j.sev].toLowerCase()} ${esc((L.INJURY_KINDS[j.kind] || j.kind).toLowerCase())}</div>
        <div class="st">${a ? 'day ' + (a.days + 1) + ' · ' + esc(a.advice) : 'from ' + esc(j.start)}</div></span><span class="chev">${icon('chev', 16)}</span></button>`; }).join('')}</section>`
      : card(`<div class="empty" style="padding:6px">Nothing logged. Hurt beyond normal soreness? Log it — today's training plan leaves it alone until you mark it healed.</div>`))
    + `<button class="btn btn-glass block" style="margin-top:10px" data-act="inj-open">${icon('plus', 16)} Log an injury</button>`;
  /* strength balance */
  let rs = [];
  try { rs = L.strengthRatios(tissueNow().lifts || [], today()); } catch (e) { rs = []; }
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Strength balance</h2><span class="k">your best lifts · 4 months</span></div>`
    + card(rs.length ? rs.map(r => {
      const col = r.verdict === 'balanced' ? '#30d158' : r.verdict === 'low' ? '#ff9f0a' : '#64d2ff', top = Math.max(r.hi * 1.3, r.ratio * 1.1), pc = x => Math.min(100, x / top * 100).toFixed(1) + '%';
      return `<div class="dv-rat"><span>${esc(r.name)}</span><span class="dv-t"><i class="band" style="left:${pc(r.lo)};width:calc(${pc(r.hi)} - ${pc(r.lo)})"></i><i class="tick" style="left:${pc(r.ratio)};background:${col};width:4px"></i></span><b class="num" style="color:${col}">${r.ratio.toFixed(2)}</b></div>
        ${r.verdict !== 'balanced' ? `<p class="sub" style="margin:0 0 8px;line-height:1.4">${esc(r.note)}</p>` : ''}`;
    }).join('') + `<p class="sub" style="margin:6px 0 0;line-height:1.4">Green band = the usual coaching range. A nudge, not a diagnosis.</p>`
      : `<div class="empty" style="padding:6px">Shows once both lifts of a pair are logged — row &amp; bench, overhead &amp; bench, leg curl &amp; extension, squat &amp; deadlift.</div>`);
  H += relBlock(v);
  return H;
}

/* ── Body Systems: a report card per system and a body age (logic/systems.ts) ── */
let sysCache = null, sysFor = null;
function systemsNow(v) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + today();
  if (sysFor === k) return sysCache;
  const t = today(), p = v.profile || {}, w = latestWeight(v) || (+p.weight || null), sp = L.specimen(Object.assign({}, p, w ? { weight: w } : {}));
  const inp = { today: t, bio: v.bio || {}, age: sp.age, sex: p.sex || null, height: +p.height || null, weight: w, bodyfat: p.bodyfat != null && p.bodyfat !== '' ? +p.bodyfat : null, vo2max: +p.vo2max || null };
  // Muscular strength (bench ÷ body weight vs age norms) or, without a bench, strength-training time (logic/systems.ts).
  try { inp.pressRatio = L.strengthForAge(tissueNow().lifts, w); inp.msaMinutes = L.trainingMinutes(v.workouts || [], t); } catch (e) { /* body age still works without them */ }
  sysCache = { rows: L.systemsReport({ ...inp, endo: v.endo || null, blood: v.bloodwork || [], rebuild: rebuildNow(v), injuries: Object.keys(L.activeInjuries(v.injuries || [], t)).length, coverage: v.body.coverage ?? null, coverage28: v.body.coverage28 ?? null }), age: L.bodyAge(inp) };
  sysFor = k; return sysCache;
}
const GRADE = { good: ['#30d158', 'Good'], watch: ['#ffd60a', 'Watch'], poor: ['#ff453a', 'Needs work'] };
/* Body Systems, all of it at once: readiness, the report card, body age and the Bio-Regen Matrix (2026-10-04). */
function secSystemsAll(v) {
  return readinessCard(v, today())
    + `<div class="ba-h"><h2 style="font-size:1.05rem">Report card</h2><span class="k">a grade per system</span></div>` + secSystems(v)
    + `<div class="ba-h"><h2 style="font-size:1.05rem">Bio-Regen Matrix</h2><span class="k">muscle telemetry · 72 h cycle</span></div>` + secRecovery(v);
}
function secSystems(v) {
  const R = systemsNow(v), A = R.age;
  let H = card(R.rows.map(r => { const g = r.grade ? GRADE[r.grade] : ['var(--t4)', 'Not measured'];
    return `<div class="sys-r${r.key === 'growth' ? ' tap' : ''}"${r.key === 'growth' ? ' data-act="rebuild-sheet" role="button" tabindex="0" aria-label="Recovery and growth — open the model"' : ''}><span class="sys-ic">${r.icon}</span><div class="sys-t"><div class="sys-n"><b>${esc(r.name)}</b><span class="sys-g" style="--g:${g[0]}">${g[1]}</span></div>
      <div class="sub">${esc(r.line)}</div>${r.action ? `<div class="sys-a">→ ${esc(r.action)}</div>` : ''}${r.key === 'growth' ? `<div class="sys-a rb-open">How muscle recovery, hormones and protein connect ${icon('chev', 12)}</div>` : ''}</div>${r.score != null ? `<b class="num sys-s" style="color:${g[0]}">${r.score}</b>` : ''}</div>`; }).join(''), 'tight sys');
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Body age</h2><span class="k">from your markers · a range, not a verdict</span></div>`;
  H += card(A.known ? `<div class="bage"><div><div class="bage-n num" style="color:${A.bodyAge <= A.age ? '#30d158' : A.bodyAge - A.age <= 3 ? '#ffd60a' : '#ff9f0a'}">${A.bodyAge}</div><div class="sub">likely ${A.low}–${A.high} · you are ${A.age}</div></div>
      ${A.lever ? `<div class="bage-l"><b>Biggest lever</b><span>${esc(A.lever.text)}</span></div>` : ''}</div>
    <div class="bage-m">${A.markers.map(m => `<div><span>${esc(m.label)}<small>${esc(m.value)} · ${esc(m.ref)}</small></span><b class="num" style="color:${m.years > 0.3 ? '#ff9f0a' : m.years < -0.3 ? '#30d158' : 'var(--t2)'}">${m.years > 0 ? '+' : ''}${m.years} yr</b></div>`).join('')}</div>
    ${A.missing.length ? `<p class="sub" style="line-height:1.45;margin:8px 0 0">Not included yet: ${esc(A.missing.join(' · '))}.</p>` : ''}
    <p class="sub" style="line-height:1.45;margin:6px 0 0">Each marker's published risk turned into years (mortality doubles about every 8 years). Markers overlap, so it is a range — steer by it, don't diagnose with it.</p>`
    : `<div class="empty" style="padding:6px">${esc(A.why)}</div>${A.age == null ? `<button class="btn btn-glass block" style="margin:4px 0 8px" data-act="body-profile">Set your birthday</button>` : ''}${A.markers.length ? `<div class="bage-m">${A.markers.map(m => `<div><span>${esc(m.label)}<small>${esc(m.value)}</small></span><b class="num">${m.years > 0 ? '+' : ''}${m.years} yr</b></div>`).join('')}</div>` : ''}`);
  return H;
}

/* ── the body profile: set once, edited rarely — under More, not in Body Arch ── */
export function bodyProfileSheet() {
  openSheet({ id: 'body-profile', title: 'Body profile', render: () => secProfile(view()) });
}

/* ── strength per kg of body weight (logic/lifts.ts relativeStrength) ── */
let relCache = null, relFor = null;
function relNow(v) {
  const k = v.workouts.length + ':' + Object.keys(v.weights || {}).length + ':' + (v.rev || 0);
  if (relFor !== k) { relCache = L.relativeStrength(v.workouts || [], v.weights || {}, today()); relFor = k; }
  return relCache;
}
function relBlock(v) {
  const R = relNow(v);
  let body;
  if (!R.known) body = `<div class="empty" style="padding:6px">${esc(R.why)} Then ARK shows whether a bulk or cut is turning into strength — raw numbers hide it.</div>`;
  else {
    const Wt = R.weight, V = R.verdict;
    body = `<div style="border-left:3px solid ${V.color};padding-left:10px;margin-bottom:10px"><b style="color:${V.color}">${esc(V.title)}</b><div class="sub" style="line-height:1.45;margin-top:2px">${esc(V.text)}</div></div>
      <div class="rel-w"><span>Body weight</span><b class="num">${fmt1(Wt.from)} → ${fmt1(Wt.to)} kg</b></div>
      ${R.lifts.map(l => `<div class="rel-r"><span class="n">${esc(l.n)}</span><span class="num sub">${Math.round(l.from)} → ${Math.round(l.to)}</span>
        <b class="num" style="color:${l.relPct > 0.5 ? '#30d158' : l.relPct < -0.5 ? '#ff9f0a' : 'var(--t2)'}">${l.relTo.toFixed(2)}×<small> ${l.relPct > 0 ? '+' : ''}${l.relPct} %</small></b></div>`).join('')}
      <p class="sub" style="line-height:1.45;margin:8px 0 0">Best est. 1RM (sets of 1–12 reps) ÷ your weight that day — first 4 of the last ${R.weeks} weeks against the last 4. 1.00× = lifting your body weight.</p>`;
  }
  return `<div class="ba-h"><h2 style="font-size:1.05rem">Strength per kg</h2><span class="k">bulk or cut — is it strength?</span></div>` + card(body);
}

/* The lifts you have logged that train this muscle — tapping the figure leads to your numbers. */
function liftsBlock(v, slug) {
  const Ls = L.liftsForMuscle(v.workouts || [], slug, today(), 5);
  if (!Ls.length) return '';
  const u = v.unit || 'kg';
  return `<div class="grp-h" style="margin-top:16px">Your lifts for it</div><section class="list frost">${Ls.map(x => {
    const tr = x.trend, arrow = !tr ? '' : tr.pct > 1 ? ` · <span style="color:#30d158">▲ ${tr.pct} %</span>` : tr.pct < -1 ? ` · <span style="color:#ff9f0a">▼ ${Math.abs(tr.pct)} %</span>` : ' · flat';
    return `<button class="li" data-act="ex-hist" data-n="${esc(x.n)}" data-seg="records"><span class="tx"><div class="tt">${esc(x.n)}</div>
      <div class="st">${x.top ? (x.top.w > 0 ? fmt1(x.top.w) + ' ' + u + ' × ' + x.top.r : x.top.r + ' reps') + ' · ' : ''}${x.sessions}× · last ${fmtDay(x.last, { day: 'numeric', month: 'short' })}${arrow}</div></span>
      <b class="num">${x.best ? Math.round(x.best.orm) : x.reps ? x.reps.v : '—'}</b><span class="chev">${icon('chev', 16)}</span></button>`;
  }).join('')}</section><p class="sub" style="line-height:1.45;margin:6px 2px 0">Number = best est. 1RM (bodyweight: most reps) · arrow = last 6 weeks against the 6 before. Tap for records.</p>`;
}

let injDraft = null;
function injurySheet(d) {
  const v = view(), ex = d.id ? (v.injuries || []).find(j => j.id === d.id) : null;
  injDraft = ex ? { ...ex } : { id: 'inj' + Date.now().toString(36), slug: d.slug || ui.sel || 'chest', kind: 'pain', sev: 1, side: 'both', note: '', start: today(), cleared: null };
  openSheet({
    id: 'injury', title: ex ? 'Injury' : 'Log an injury',
    render: () => {
      const D = injDraft, chip = (f, val, lbl) => `<button class="chip ${D[f] === val ? 'on' : ''}" data-act="inj-f" data-f="${f}" data-v="${val}">${lbl}</button>`;
      const a = L.activeInjuries([{ ...D, cleared: null }], today())[D.slug];
      return `<label class="field"><span>Muscle</span><select class="inp" data-inj="slug">${Object.keys(L.VOLUME_LANDMARKS).map(s => `<option value="${s}" ${s === D.slug ? 'selected' : ''}>${esc(mName(s))}</option>`).join('')}</select></label>
        <div class="field"><span>What it is</span><div class="chips">${Object.keys(L.INJURY_KINDS).map(k => chip('kind', k, L.INJURY_KINDS[k])).join('')}</div></div>
        <div class="field"><span>How bad</span><div class="chips">${chip('sev', 1, 'Mild — train around it')}${chip('sev', 2, 'Moderate — rest it')}${chip('sev', 3, 'Severe — get it checked')}</div></div>
        <div class="field"><span>Side</span><div class="chips">${chip('side', 'both', 'Both / middle')}${chip('side', 'L', 'Left')}${chip('side', 'R', 'Right')}</div></div>
        <label class="field"><span>Started</span><input class="inp" type="date" max="${today()}" value="${esc(D.start)}" data-inj="start"></label>
        <label class="field"><span>Note</span><input class="inp" maxlength="300" placeholder="Optional — what happened, what hurts" value="${esc(D.note || '')}" data-inj="note"></label>
        ${a ? `<p class="sub" style="line-height:1.45;margin:-4px 0 14px">${esc(a.advice)}</p>` : ''}
        <button class="btn btn-prominent block" data-act="inj-save">${ex ? 'Save' : 'Log injury'}</button>
        ${ex ? `<div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-tint" style="flex:1;--accent:#30d158" data-act="inj-heal">✓ Healed</button>
          <button class="btn btn-glass" style="flex:1" data-act="inj-del">Delete</button></div>` : ''}`;
    },
  });
}
function injRead() {
  const g = k => document.querySelector('[data-inj="' + k + '"]');
  if (g('slug')) injDraft.slug = g('slug').value;
  if (g('start') && g('start').value) injDraft.start = g('start').value;
  if (g('note')) injDraft.note = g('note').value;
}
function tapeSheet() {
  const v = view(), day0 = today();
  openSheet({
    id: 'tape', title: 'Tape measurements',
    render: () => {
      const cur = (v.measures || {})[day0] || {}, fem = String((v.profile || {}).sex).toLowerCase() === 'female';
      return `<p class="sub" style="line-height:1.45;margin:0 0 12px">Centimetres. Morning, before eating, relaxed — same spot each time. Waist at the navel, neck just below the Adam's apple${fem ? ', hips at the widest point' : ''}.</p>
        <div class="grid2">${L.MEASURE_FIELDS.filter(f => f[0] !== 'hip' || fem || cur.hip).map(f => `<label class="field"><span>${esc(f[1])}</span>
          <input class="inp num" type="number" inputmode="decimal" step="0.1" min="${f[2][0]}" max="${f[2][1]}" value="${cur[f[0]] ?? ''}" data-tape="${f[0]}"></label>`).join('')}</div>
        <label class="field"><span>Day</span><input class="inp" type="date" max="${day0}" value="${day0}" data-tape-day></label>
        <button class="btn btn-prominent block" data-act="tape-save">Save</button>`;
    },
  });
}
const devActions = {
  'ba-muscle'(d) { muscleSheet(d.slug); },
  'inj-open'(d) { injurySheet(d); },
  'inj-f'(d) { injRead(); injDraft[d.f] = d.f === 'sev' ? Number(d.v) : d.v; haptic(); changed(); },
  'inj-save'() {
    injRead();
    const j = L.cleanInjury(injDraft);
    if (!j) { toast('Pick a muscle, a severity and a start day'); return; }
    emit('injury.set', { injury: j }); closeSheet(topSheet()); haptic();
    toast(j.sev >= 2 ? '✚ Logged — the training plan leaves it alone' : '✚ Logged — train around it');
  },
  'inj-heal'() {
    injRead(); injDraft.cleared = today();
    emit('injury.set', { injury: L.cleanInjury(injDraft) }); closeSheet(topSheet()); haptic(); toast('✓ Marked healed');
  },
  'inj-del'() {
    const id = injDraft.id;
    const evs = state.pending.filter(e => !e.seq && e.type === 'injury.set' && e.data.injury && e.data.injury.id === id);
    const onPc = !!((state.snapshot && state.snapshot.injuries) || []).some(j => j.id === id);
    closeSheet(topSheet());
    if (!onPc) { evs.forEach(e => dropPending(e.id)); toast('Injury removed'); return; }
    if (!confirm('Delete this injury record? Marking it healed keeps the history. ARK on your PC keeps a copy you can restore.')) return;
    emitUndoable('injury.del', { id }, 'Injury deleted');
  },
  'tape-open'() { tapeSheet(); },
  'tape-save'() {
    const m = {}; document.querySelectorAll('[data-tape]').forEach(el => { if (el.value !== '') m[el.dataset.tape] = Number(el.value); });
    const day = (document.querySelector('[data-tape-day]') || {}).value || today();
    const c = L.cleanMeasure(m);
    if (!Object.keys(c).length) { toast('Enter at least one measurement'); return; }
    const prev = (view().measures || {})[day] || {};
    emit('measure.set', { day, m: { ...prev, ...c } }); closeSheet(topSheet()); haptic(); toast('📏 Saved');
  },
};

/* ══════════════ actions ══════════════ */
export const actions = {
  'body-profile'() { bodyProfileSheet(); },
  'tpl-area'(d) {
    const T = L.areaTemplate(d.a); if (!T) return;
    if ((view().routines || []).some(r => r.name === T.name)) { toast('Already in your templates'); return; }
    emit('routine.add', { routine: T }); haptic();
    toast(T.name + ' added — Train › Templates');
  },
  ...devActions,
  'blood-add'() { bloodSheet(); },
  'blood-save'() {
    const g = k => (document.querySelector('[data-b="' + k + '"]')?.value || '').trim();
    const entry = { id: 'b' + Date.now(), marker: g('marker'), value: g('value'), unit: g('unit'), lo: g('lo'), hi: g('hi'), date: g('date') };
    if (!L.cleanBloodEntry(entry)) { toast('A result needs a marker, a number and a date'); return; }
    emit('bloodwork.add', { entry }); closeSheet(topSheet()); haptic(); toast('🧪 ' + entry.marker + ' saved');
  },
  'blood-del'(d) {
    const ev = state.pending.find(e => !e.seq && e.type === 'bloodwork.add' && e.data.entry && e.data.entry.id === d.id);
    if (ev) { dropPending(ev.id); toast('Result removed'); return; }
    if (!confirm('Delete this lab result? ARK on your PC keeps a copy you can restore.')) return;
    emitUndoable('bloodwork.del', { id: d.id }, 'Result deleted');
  },
  'ba-toggle'(d) { const o = baOpen(); o[d.sec] = !isOpen(d.sec); haptic(); changed({ now: true }); },
  'ba-all'() {
    const o = baOpen(), all = allOpen();
    SECTIONS.forEach(x => { o[x[0]] = !all; }); if (all) o['ba-scan'] = true;
    haptic(); changed({ now: true });
  },
  'ba-jump'(d) {
    const o = baOpen();
    if (!isOpen(d.sec)) { o[d.sec] = true; changed({ now: true }); setTimeout(() => actions['ba-jump'](d), 60); return; }
    const el = document.getElementById(d.sec);
    if (!el) { state.tab = 'body'; changed(); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.jump button').forEach(b => b.classList.toggle('on', b.dataset.sec === d.sec));
  },
  'ba-face'(d) { ui.face = d.face; haptic(); changed(); },
  'ba-mode'(d) { ui.mode = d.mode; haptic(); changed(); },
  muscle(d) { haptic(); muscleSheet(d.slug); },
  'train-slug'(d) { if (topSheet() && topSheet().id === 'muscle') closeSheet(topSheet()); startForMuscles([d.slug]); },
  'ms-rate'(d) {
    const cur = ((bySlug(view())[d.slug] || {}).metric || {})[d.f] || 0, v = Number(d.v);
    if (cur === v) return;
    haptic(); emit('muscle.set', { slug: d.slug, fields: { [d.f]: v } });
  },
  'ms-sore'(d) { haptic(); emit('muscle.set', { slug: d.slug, fields: { soreness: Number(d.v) } }); },
  'ms-stretch'(d) {
    const v = ((bySlug(view())[d.slug] || {}).metric || {}).mobility || 0;
    haptic(); emit('muscle.stretch', { slug: d.slug, v }); toast('Stretch reading logged · ' + v + '/10');
  },
  'ms-pin'(d) { const on = !(view().body.pins || {})[d.slug]; haptic(); emit('muscle.pin', { slug: d.slug, on }); },
  'prof-edit'(d) { profileSheet(d.k); },
  'prof-set'(d) { haptic(); emit('profile.set', { fields: { [d.k]: d.v } }); },
  'prof-save'(d) {
    const el = document.querySelector('[data-prof-input]'); const raw = el ? el.value.trim() : '';
    if (!raw) { toast('Enter a value'); return; }
    const patch = L.cleanProfilePatch({ [d.k]: d.k === 'birthday' ? raw : Number(raw.replace(',', '.')) });
    if (!(d.k in patch)) { toast('That value is outside the valid range'); return; }
    emit('profile.set', { fields: patch }); closeSheet(topSheet()); haptic(); toast('Saved');
  },
  'mind-tag'(d) { haptic(); emit('bio.mind', { day: today(), tag: d.tag, on: d.on === '1' }); },
  'ar-why'(d) { haptic(); arSheet(d.slug); },
  'str-why'(d) { haptic(); whySheet(d.slug, 'strength'); },
  'tendon-why'(d) { haptic(); whySheet(d.slug, 'tendon'); },
  'ax-toggle'(d) { ui.open[d.k] = !ui.open[d.k]; changed(); },
};
/** Scrubbing the timeline repaints the figure and the stats without redrawing the page. */
export function onTimeline(el) {
  ui.tl = 14 - Number(el.value);
  paint();
  const lbl = document.querySelector('[data-tl-label]');
  if (lbl) { lbl.textContent = tlLabel(); lbl.classList.toggle('live', ui.tl === 0); }
  const st = document.querySelector('[data-scan-stats]');
  if (st) st.innerHTML = scanStats(view());
}
