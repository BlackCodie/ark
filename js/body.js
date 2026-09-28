/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Body Arch, entire.

   The same sections as on the PC, in the same order, fitted to a phone:
   Scanner (the figure, overlays, timeline, TRAIN NEXT, DOW-7) · Recovery
   (Bio-Regen Matrix) · Profile (Specimen + Physique) · Vitals · Mind ·
   Micros · Endocrine. Nothing is hidden; the chips at the top jump.

   Everything you can log on the PC's Body Arch you can log here. Physique and
   the endocrine estimate are shown as the PC last computed them; the shared
   maths (readiness, figure colours, profile, progression) runs here too from
   ARK_LOGIC, so it answers instantly and agrees with the PC.
   ══════════════════════════════════════════════════════════════════════ */
import {
  L, state, view, emit, emitUndoable, dropPending, changed, esc, icon, today, shiftDay, fmt1, fmtDay, ringSvg, sparkSvg, barsSvg,
  haptic, toast, openSheet, topSheet, closeSheet, scheduleSync, daysBetween,
} from './core.js';
import { GROUPS, trainNext, syncButton, bioPatch, MOODS } from './views.js';
import { startForMuscles, tissueNow } from './train.js';
import { secMind } from './mind.js';
import { standing, fmtAmt } from './doses.js';
import { hormoneRows } from './hormones.js';

const ui = { face: 'front', mode: 'status', tl: 0, sel: null, open: {} };
const MODES = [['status', 'Status'], ['strength', 'Strength'], ['mobility', 'Mobility'], ['soreness', 'Soreness'], ['volume', 'Thermal']];
const SECTIONS = [['ba-scan', 'Scanner'], ['ba-rec', 'Recovery'], ['ba-prof', 'Profile'], ['ba-vit', 'Vitals'], ['ba-mind', 'Mind'], ['ba-mic', 'Micros'], ['ba-endo', 'Endocrine']];
const STATE_LBL = {
  fresh: ['Fresh', '#30d158'], recovering: ['Recovering', '#ffb340'], ready: ['Ready', '#40c8e0'],
  detrained: ['Detrained', '#ff6b5a'], untouched: ['Untouched', 'rgba(235,240,245,.5)'],
};
const SW_TYPE_COLORS = { push: '#f87171', pull: '#818cf8', legs: '#22c55e', core: '#a78bfa', full: '#22d3ee' };
const REGEN_LBL = { dormant: ['Dormant', 'rgba(235,240,245,.45)'], charging: ['Charging', '#ffb340'], primed: ['Primed', '#30d158'], atrophy: ['Atrophy', '#ff6b5a'] };
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
    const p = L.muscleFill(ui.mode, m.metric || {}, last || null, m.vol30 || 0, v.body.peak || 1, now, s === ui.sel);
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
  if (ui.mode === 'status') return `<span><i style="background:rgba(34,197,94,.6)"></i>Fresh ≤48 h</span><span><i style="background:rgba(245,158,11,.6)"></i>Recovering → 7 d</span><span><i style="background:rgba(112,140,178,.35)"></i>Idle</span><span><i style="background:rgba(239,68,68,.6)"></i>Sore (your verdict)</span>`;
  if (ui.mode === 'soreness') return SORE_LBL.map((l, i) => `<span><i style="background:${SORE_COLORS[i]}"></i>${l}</span>`).join('');
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
  const t = today();
  const tn = v.body.muscles.filter(m => m.priority > 0.05).slice(0, 3);
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

  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Train next</h2><span class="k">readiness × volume deficit × imprint</span></div>`;
  H += tn.length ? `<div class="tn">${tn.map(m => {
    const why = m.deficit > 0 ? m.deficit + ' set' + (m.deficit === 1 ? '' : 's') + ' below target' : 'ready to load';
    const sc = (STATE_LBL[m.state] || STATE_LBL.untouched)[1];
    return `<button class="frost" data-act="train-slug" data-slug="${m.slug}"><b>${esc(m.name)}</b><span class="w">${why}</span>
      <span class="m"><span style="color:${sc}">●</span> ${esc(m.state.toUpperCase())} · ${m.weekSets}/${m.target} sets</span>
      <span class="go">Start ${icon('chev', 14)}</span></button>`;
  }).join('')}</div>` : card(`<div class="empty" style="padding:6px">Everything is inside its recovery window — rest is the correct move.</div>`);

  /* DOW-7 */
  const days = [6, 5, 4, 3, 2, 1, 0].map(i => shiftDay(t, -i));
  const ws = v.workouts;
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">DOW-7</h2><span class="k">sessions by day</span></div>` + card(`<div class="dow">${days.map(k => {
    const s = ws.filter(w => w.date === k), ty = s.length ? s[s.length - 1].type : null;
    return `<div class="${k === t ? 't ' : ''}${ty ? 'on' : ''}" ${ty ? `style="--c:${SW_TYPE_COLORS[ty] || '#40c8e0'}"` : ''}>${fmtDay(k, { weekday: 'narrow' })}<small>${ty ? esc(ty) : '·'}</small></div>`;
  }).join('')}</div>` + (() => {
    const wkStart = shiftDay(t, -((new Date().getDay() + 6) % 7));
    const cnt = {}; ws.filter(w => w.date >= wkStart).forEach(w => { cnt[w.type] = (cnt[w.type] || 0) + 1; });
    const keys = Object.keys(cnt);
    return keys.length ? `<div class="ppl">${keys.map(k => `<span class="tag" style="--c:${SW_TYPE_COLORS[k] || '#40c8e0'}">${cnt[k]}× ${esc(k)}</span>`).join('')}</div>` : '';
  })(), 'tight');
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
    <div class="frost"><div class="v num" style="color:#40c8e0">${R.lvl}</div><div class="k">Specimen lvl</div></div>
    <div class="frost"><div class="v num" style="color:#30d158">${R.impAvg}%</div><div class="k">Imprint</div></div>
    <div class="frost"><div class="v num" style="color:#ffb340">${R.weekSets}</div><div class="k">Sets / wk</div></div>
    <div class="frost"><div class="v num" style="color:#bf5af2">${R.primed}/6</div><div class="k">Primed</div></div></div>`;
  const n = {}; S.forEach(s => { n[s.state] = (n[s.state] || 0) + 1; });
  const dom = Object.keys(n).sort((a, b) => n[b] - n[a])[0];
  if (S.length >= 6 && n[dom] >= 4) {
    const col = (REGEN_LBL[dom] || REGEN_LBL.dormant)[1];
    const txt = { dormant: 'dormant — never trained', charging: 'charging — inside the recovery window', primed: 'primed — recovered and ready', atrophy: 'in atrophy — past 7 days, retrain' }[dom];
    H += `<div class="uni frost" style="--uc:${col}"><span class="dot"></span><span><b>${n[dom]} of 6 groups</b> ${txt}</span></div>`;
  }
  H += `<div class="grp2">${S.map(s => {
    const st = REGEN_LBL[s.state] || REGEN_LBL.dormant;
    return `<div class="gc frost" style="--gcc:${s.color}"><div class="top"><span>${s.icon}</span>${esc(s.name.charAt(0) + s.name.slice(1).toLowerCase())}<span class="tag" style="--c:${st[1]}">${st[0].toUpperCase()}</span></div>
      <div class="rb"><i style="width:${s.fillPct}%;background:${s.fillCol}"></i></div>
      <div class="rm"><span>Recovery ${esc(s.pctTxt)}</span><span>${esc(String(s.lastTxt).replace('last: ', ''))}</span></div>
      <div class="mini"><span>IMPRINT</span><span class="t"><i style="width:${s.imprint}%;background:#30d158"></i></span><b>${s.imprint}%</b>
        <span>MOBILITY</span><span class="t"><i style="width:${s.mobPct}%;background:#40c8e0"></i></span><b>${s.mobPct}%</b>
        <span>VOL/WK</span><span class="t"><i style="width:${s.volPct}%;background:#ffb340"></i></span><b>${s.wk}/10</b></div></div>`;
  }).join('')}</div>`;
  const tn = trainNext(v), regenBy = Object.fromEntries(S.map(s => [s.key, s]));
  const stTop = tn.length ? (regenBy[tn[0].group] || {}).state : null;
  H += card(`<div class="radar-row"><div>${radarSvg(S)}</div><div class="np">
    ${tn.length ? `<div class="hl">⚡ Train: ${tn.map(m => GROUPS[m.group][0]).join(' · ')}</div>
      <div class="why">${stTop === 'atrophy' ? 'Adaptation is fading in these groups — retraining comes first.' : stTop === 'dormant' ? 'Recovered groups first, then the ones never trained.' : 'Recovered groups with the lightest weekly volume.'} Same ranking as TRAIN NEXT.</div>
      ${tn.map(m => { const g = regenBy[m.group] || {}; const st = REGEN_LBL[g.state] || REGEN_LBL.dormant;
        return `<div class="pick">${esc(GROUPS[m.group][0])}<span class="tag" style="--c:${st[1]}">${st[0].toUpperCase()}</span></div>`; }).join('')}`
    : `<div class="hl">⟳ Active recovery day</div><div class="why">Every group is inside its recovery window — sleep, mobility, steps.</div>`}
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
const VIT = [
  { f: 'sleep', ic: 'moon', c: '#7d7aff', n: 'Sleep', u: 'h', steps: [-0.5, 0.5, 1], round: 0.5, goal: 'sleep' },
  { f: 'deep', ic: 'moon', c: '#5e5ce6', n: 'Deep sleep', u: 'h', steps: [-0.25, 0.25, 0.5], round: 0.25 },
  { f: 'prot', ic: 'meat', c: '#ff7a7a', n: 'Protein', u: 'g', steps: [25, 50], round: 1, goal: 'prot' },
  { f: 'water', ic: 'drop', c: '#40c8e0', n: 'Hydration', u: 'L', steps: [0.5, 1], round: 0.1, goal: 'water' },
  { f: 'weight', ic: 'scale', c: '#40c8e0', n: 'Body weight', u: 'kg', steps: [-0.1, 0.1], round: 0.1 },
  { f: 'steps', ic: 'target', c: '#30d158', n: 'Steps', u: '', steps: [1000, 5000], round: 1, goal: 'steps' },
  { f: 'cal', ic: 'flame', c: '#ff9f0a', n: 'Calories', u: 'kcal', steps: [100, 500], round: 1, goal: 'cal' },
];
function readinessCard(v, t) {
  const r = v.readiness[t];
  const col = r == null ? 'rgba(235,240,245,.3)' : r >= 80 ? '#30d158' : r >= 60 ? '#ffd60a' : r >= 40 ? '#ff9f0a' : '#ff453a';
  const lbl = r == null ? 'Log data to score' : r >= 90 ? 'Elite condition' : r >= 80 ? 'Peak ready' : r >= 70 ? 'Good to train' : r >= 55 ? 'Train smart' : r >= 40 ? 'Go light' : 'Recover';
  const hist = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(i => v.readiness[shiftDay(t, -i)]);
  const pres = hist.filter(x => x != null);
  return card(`<div class="row" style="gap:16px">
      <div style="color:${col}">${ringSvg(r == null ? 0 : r / 100, col, 80, 9, r == null ? '—' : Math.round(r))}</div>
      <div style="flex:1"><div class="eyebrow">Readiness</div><div style="font-size:1.2rem;font-weight:700;margin-top:2px">${lbl}</div>
        <div class="sub" style="margin-top:3px">${r == null ? 'Sleep, energy, mood, water or protein — any one starts it' : 'From today\'s vitals — the same score your PC shows'}</div></div></div>
    ${pres.length ? `<div class="row num" style="gap:14px;margin-top:10px;font-size:.78rem"><span><b>${Math.round(pres.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, pres.length))}</b> <span class="sub">7-day avg</span></span><span><b>${Math.max(...pres)}</b> <span class="sub">14-day best</span></span></div>
      <div style="margin-top:6px">${barsSvg(hist.map(x => x || 0), col, 40)}</div>` : ''}`);
}
function hud(v, t) {
  const d = v.bio[t] || {}, y = v.bio[shiftDay(t, -1)] || {}, G = (v.bioDefs && v.bioDefs.goals) || { cal: 2500, water: 3, sleep: 8 };
  const rd = v.readiness[t], ry = v.readiness[shiftDay(t, -1)];
  const T = [
    ['HEALTH', '#ff6b5a', rd, rd == null ? '—' : rd, rd == null ? '' : '%', rd, ry, 100],
    ['STAMINA', '#ffd60a', d.energy, d.energy ?? '—', d.energy == null ? '' : '/10', d.energy, y.energy, 10],
    ['FOOD', '#ff9f0a', d.cal || 0, (d.cal || 0) >= 1000 ? fmt1((d.cal || 0) / 1000) + 'k' : (d.cal || 0), '', d.cal || 0, y.cal, G.cal],
    ['WATER', '#40c8e0', d.water || 0, fmt1(d.water || 0), 'L', d.water || 0, y.water, G.water],
    ['OXYGEN', '#64d2ff', d.sleep || 0, fmt1(d.sleep || 0), 'h', d.sleep || 0, y.sleep, G.sleep],
    ['TORPOR', '#bf5af2', d.stress, d.stress ?? '—', d.stress == null ? '' : '/10', d.stress, y.stress, 10, true],
  ];
  return `<div class="hud">${T.map(([n, c, raw, shown, unit, cur, prev, max, inv]) => {
    let dl = '';
    if (cur != null && prev != null) {
      const diff = cur - prev, good = inv ? diff < 0 : diff > 0;
      dl = Math.abs(diff) < 0.05 ? '<span class="d flat">±0</span>' : `<span class="d ${good ? 'up' : 'down'}">${diff > 0 ? '▲' : '▼'}${Math.abs(diff) >= 1 ? Math.round(Math.abs(diff)) : Math.abs(diff).toFixed(1)}</span>`;
    }
    const pct = raw == null ? 0 : Math.max(0, Math.min(100, raw / (max || 1) * 100));
    return `<div style="--hc:${c}"><div class="n">${n}</div><div class="v num">${shown}<small>${unit}</small>${dl}</div><div class="b"><i style="width:${pct}%"></i></div></div>`;
  }).join('')}</div>`;
}
function vitalsInputs(v, t) {
  const d = v.bio[t] || {}, G = (v.bioDefs && v.bioDefs.goals) || {};
  return VIT.map(x => {
    const cur = d[x.f];
    if (x.scale) return `<div class="vin" style="--c:${x.c}"><span class="vi">${icon(x.ic, 17)}</span>
      <div class="top"><span class="nm">${x.n}</span><span class="val ${cur == null ? 'none' : ''}">${cur == null ? '—' : cur + '<small> /10</small>'}</span></div>
      <div class="scale fill">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button class="${cur === n ? 'on' : ''}" style="--c:${x.c}" data-act="bio-set" data-f="${x.f}" data-v="${n}">${n}</button>`).join('')}</div></div>`;
    const goal = x.goal ? G[x.goal] : null;
    const shown = cur == null ? '—' : x.f === 'steps' ? Math.round(cur).toLocaleString() : fmt1(cur);
    return `<div class="vin" style="--c:${x.c}"><span class="vi">${icon(x.ic, 17)}</span>
      <div class="top"><span class="nm">${x.n}</span><span class="val ${cur == null ? 'none' : ''}">${shown}${cur != null && x.u ? '<small> ' + x.u + '</small>' : ''}${goal ? `<small> / ${goal >= 1000 ? fmt1(goal / 1000) + 'k' : goal}</small>` : ''}</span></div>
      ${goal ? `<div class="bar" style="--c:${x.c}"><i style="width:${Math.min(100, (cur || 0) / goal * 100)}%"></i></div>` : ''}
      <div class="ctl">${x.steps.map(s => `<button data-act="vit-step" data-f="${x.f}" data-d="${s}">${s > 0 ? '+' : '−'}${Math.abs(s) >= 1000 ? Math.abs(s) / 1000 + 'k' : Math.abs(s)}</button>`).join('')}
        ${cur != null ? `<button class="x" data-act="vit-clear" data-f="${x.f}" aria-label="Clear ${x.n}">${icon('x', 14)}</button>` : ''}</div></div>`;
  }).join('');
}
function secVitals(v) {
  const t = today();
  let H = readinessCard(v, t);
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Survivor vitals</h2><span class="k">vs yesterday</span></div>` + hud(v, t);
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Log today</h2><span class="k">${fmtDay(t, { weekday: 'long' })}</span></div>` + card(vitalsInputs(v, t), 'tight');
  const days = [6, 5, 4, 3, 2, 1, 0].map(i => shiftDay(t, -i));
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Last 7 days</h2><span class="k">readiness</span></div><div class="strip7">${days.map(k => {
    const r = v.readiness[k], c = r == null ? '' : r >= 80 ? '#30d158' : r >= 60 ? '#ffd60a' : r >= 40 ? '#ff9f0a' : '#ff453a';
    return `<div class="${k === t ? 't' : ''}"><b ${c ? `style="color:${c}"` : ''}>${r ?? '—'}</b>${fmtDay(k, { weekday: 'narrow' })}</div>`;
  }).join('')}</div>`;
  return H;
}

/* ── micros: every dose has a time; the kinetics model says what is in you now ── */
function secMicros(v) {
  const t = today(), D = v.bioDefs;
  if (!D || !D.micros || !D.micros.length) return card(`<div class="empty">Micronutrient tracking appears after the first sync.</div>`);
  const amt = (v.bio[t] || {}).micros || {};
  const fmtN = n => n >= 1000 ? (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : (n % 1 === 0 ? '' + n : (+n).toFixed(1));
  const goals = D.micros.filter(m => !m.limit);
  const hit = goals.filter(m => (amt[m.k] || 0) >= m.goal).length;
  let H = `<div class="sub" style="margin:-4px 2px 8px;line-height:1.45">${hit}/${goals.length} at target today · tap one to log it with the time you took it and see what is in you now.</div>`;
  (D.cats || []).forEach(cat => {
    const items = D.micros.filter(m => m.cat === cat);
    if (!items.length) return;
    const lim = items.every(m => m.limit);
    H += `<div class="mcat"><span>${esc(cat)}</span><span>${lim ? 'limits' : items.filter(m => (amt[m.k] || 0) >= m.goal).length + '/' + items.length}</span></div>`;
    H += card(items.map(m => {
      const a = amt[m.k] || 0, saf = L.microSafety(m.k, a), over = (saf && saf.level === 'over') || (m.limit && a > (m.goal || 0));
      const pct = m.limit ? (a > 0 ? 1 : 0) : Math.min(1, a / (m.goal || 1));
      const col = over ? '#ff453a' : m.c;
      const S = standing(m.k);
      const est = S ? (S.store && S.store.v != null ? S.store.label + ' ' + S.store.v + S.store.unit.replace(/^%/, '%') : S.store && S.store.text ? S.store.label.replace(' (estimate)', '') + ': ' + S.store.text : S.line) : '';
      const step = (m.steps || [])[0];
      return `<div class="mic2" style="--mc:${col}">
        <button class="mic2-main" data-act="dose-sheet" data-k="${m.k}" aria-label="${esc(m.name)} — log a dose and see the estimate">
          <span class="ring">${ringSvg(pct, col, 44, 5.5, m.limit ? (a ? fmtN(a) : '0') : over ? '!' : a >= m.goal ? '✓' : Math.round(pct * 100))}</span>
          <span class="tx"><span class="nm">${m.icon} ${esc(m.name)}</span>
            <span class="amt">${m.limit ? (a ? fmtN(a) + ' ' + esc(m.unit) + ' today' : 'none today') + ' · keep at ' + fmtN(m.goal || 0) : fmtN(a) + ' / ' + fmtN(m.goal) + ' ' + esc(m.unit)}</span>
            ${est ? `<span class="est">${esc(est)}</span>` : ''}
            ${saf && !m.limit ? `<span class="warn ${saf.level}">⚠ ${saf.level === 'over' ? 'Over upper limit' : 'Nearing upper limit'} · ${fmtN(saf.ul)} ${esc(saf.unit)}</span>` : ''}</span></button>
        ${step ? `<button class="mic2-add" data-act="dose-quick" data-k="${m.k}" data-v="${step}" aria-label="Log ${fmtN(step)} ${esc(m.unit)} of ${esc(m.name)} now">+${fmtN(step)}</button>` : ''}</div>`;
    }).join(''), 'tight mic-list');
  });
  H += `<p class="sub" style="margin:10px 4px 0;line-height:1.45">Amounts in blood are estimates from dose times and population-average kinetics (±30–50 % between people), not lab values. Caffeine at bedtime, alcohol, creatine, vitamin D and ashwagandha feed the hormone and mind models.</p>`;
  return H;
}

/* ── endocrine: a clean list; each hormone opens its day and 21-day charts (js/hormones.js) ── */
function secEndo(v) {
  const E = v.endo;
  let H = `<div class="sim slim"><span>ⓘ</span><div>Estimates on a 0–100 scale from ARK's hormone model, computed on your PC — <b>not blood levels</b>. Tap a hormone for its day, hour by hour, and the last 3 weeks.</div></div>`;
  if (!E) return H + card(`<div class="empty">Nothing estimated yet. Log sleep, stress, intake or a workout and your PC's engine begins estimating.</div>`) + bloodCard(v);
  const cc = E.confidence >= 0.55 ? '#30d158' : E.confidence >= 0.3 ? '#ffb340' : '#ff6b5a';
  H += hormoneRows(v);
  H += `<div class="ehdr slim"><div><div class="v" style="color:${cc}">${Math.round(E.confidence * 100)}%</div><div class="k">Confidence</div></div>
    <div><div class="v">${E.days}d</div><div class="k">History</div></div><div><div class="v">${E.samples}</div><div class="k">Simulations</div></div></div>`;
  if (E.next && E.next.length) H += `<div class="eyebrow" style="margin:10px 2px 6px">Log these to sharpen the estimate</div><div class="chips" style="margin-bottom:10px">${E.next.map(n =>
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
    + card(`<p class="sub" style="margin:0 0 ${M.length ? 10 : 0}px;line-height:1.5">Your lab results exactly as reported. They sit beside the estimate and never change it — ARK does not interpret them. Ask your doctor what they mean.</p>
      ${M.length ? `<div class="list">${M.map(m => {
        const L0 = m.latest, st = L.bloodStatus(L0);
        return `<div class="li" style="padding-left:0;padding-right:0"><span class="tx"><div class="tt">${esc(L0.marker)}</div>
          <div class="st" style="white-space:normal"><b class="num" style="color:var(--t1);font-size:.95rem">${esc(String(L0.value))}</b> ${esc(L0.unit || '')} · ${fmtDay(L0.date, { day: 'numeric', month: 'short', year: 'numeric' })}${L0.lo != null || L0.hi != null ? ' · range ' + esc((L0.lo ?? '') + '–' + (L0.hi ?? '')) : ''}${m.series.length > 1 ? ' · ' + m.series.slice(-4).map(x => x.value).join(' → ') : ''}</div></span>
          ${st ? `<span class="tag" style="--c:${st === 'in' ? '#30d158' : '#ffb340'}">${st === 'in' ? 'in range' : st}</span>` : ''}
          <button class="circle sm" data-act="blood-del" data-id="${esc(L0.id)}" aria-label="Delete this ${esc(L0.marker)} result">${icon('trash', 15)}</button></div>`;
      }).join('')}</div>` : ''}`);
}
const BLOOD_COMMON = ['Total testosterone', 'Free testosterone', 'Estradiol', 'SHBG', 'Cortisol (morning)', 'IGF-1', 'TSH', 'Free T3', 'Free T4',
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
    `<button class="${i === 0 ? 'on' : ''}" data-act="ba-jump" data-sec="${s[0]}">${s[1]}</button>`).join('')}</div></nav>`;
  if (!v.body.muscles.length) {
    return H + card(`<div class="empty">Body Arch fills in after the first sync with ARK on your PC.</div>`);
  }
  lastSecs = sections(v);
  return H + Object.values(lastSecs).join('');
}

const SEC_DEFS = [
  ['ba-scan', 'Scanner', 'biomechanical matrix', secScanner],
  ['ba-rec', 'Bio-Regen Matrix', 'muscle telemetry · 72 h cycle', secRecovery],
  ['ba-prof', 'Specimen Profile', 'biometry · composition', secProfile],
  ['ba-vit', 'Biometric Status', '', secVitals],
  ['ba-mind', 'Mental State', 'neural link', secMind],
  ['ba-mic', 'Micronutrients', '', secMicros],
  ['ba-endo', 'Endocrine Estimate', '', secEndo],
];
function sections(v) {
  const out = {};
  SEC_DEFS.forEach(([id, title, k, fn]) => {
    out[id] = `<section class="ba-sec" id="${id}"><div class="ba-h"><h2>${title}</h2>${k ? `<span class="k">${k}</span>` : ''}</div>${fn(v)}</section>`;
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
  let scan = false;
  Object.keys(next).forEach(id => {
    if (next[id] === lastSecs[id]) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.outerHTML = next[id];
    if (id === 'ba-scan') scan = true;
  });
  lastSecs = next;
  if (scan) mountFigure(); else paint();
  return true;
}

/* keep the jump chips in step with where you are */
let watching = false;
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
      const log = ((v.body.mobLog || {})[slug] || []).slice(-10);
      const rate = (field, c, cur) => `<div class="rate" style="--c:${c}">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
        `<button class="${n === cur ? 'on' : n > 0 && n < cur ? 'lo' : ''}" data-act="ms-rate" data-slug="${slug}" data-f="${field}" data-v="${n}">${n === 0 ? '–' : n}</button>`).join('')}</div>`;
      const vol = m.vol30 || 0;
      const T = tissueNow(), tm = T.muscles[slug] || null;
      const tens = tm ? tm.tendons.map(k => T.tendons[k]).filter(Boolean) : [];
      const TST = { spike: ['Load spike', '#ff453a'], building: ['Building', '#40c8e0'], steady: ['Steady', '#30d158'], detraining: ['Detraining', '#ffb340'], untrained: ['Untrained', 'rgba(235,240,245,.5)'] };
      const zc = !tm || tm.weekSets < 6 ? '#ffb340' : tm.weekSets <= 20 ? '#30d158' : '#ff9f0a';
      const tile = (c, k, val, unit, sub, bar) => `<div class="mt" style="--c:${c}"><div class="k">${k}</div><div class="v num">${val}<small>${unit}</small></div>
        ${bar != null ? `<div class="b"><i style="width:${Math.max(0, Math.min(100, bar))}%"></i></div>` : ''}<div class="s">${sub}</div></div>`;
      const logged = new Set(v.workouts.flatMap(w => (w.exercises || []).map(e => L.canonicalName(e.n))));
      const moves = L.EXERCISES.filter(x => (x.load[slug] || 0) >= 0.8)
        .sort((a, b) => (logged.has(b.n) ? 1 : 0) - (logged.has(a.n) ? 1 : 0)).slice(0, 5);
      const tCap = tens.length ? Math.min(...tens.map(x => x.capacity)) : null;
      return `${bio.lat ? `<div class="ms-lat">${esc(bio.lat)}</div>` : ''}
      <div class="ms-state"><span class="tag" style="--c:${st[1]}">${st[0].toUpperCase()}</span>
        ${m.group ? `<span class="tag">${esc(GROUPS[m.group] ? GROUPS[m.group][0] : m.group)}</span>` : ''}
        ${bio.rec ? `<span class="tag">Recovers in ${esc(bio.rec)}</span>` : ''}${pinned ? '<span class="tag" style="--c:#bf5af2">Pinned</span>' : ''}</div>
      <div class="mtiles">
        <button class="mt-btn" data-act="str-why" data-slug="${slug}" aria-label="How strength is estimated">${tm && tm.strength
          ? tile('#30d158', 'Strength', tm.strength.score, '/100', esc(tm.strength.level) + ' · ' + tm.strength.rel + '× body weight', tm.strength.score)
          : tile('#30d158', 'Strength', '—', '', 'log a main lift for an estimate', null)}</button>
        ${tile('#40c8e0', 'Mobility', met.mobility ? met.mobility : '—', met.mobility ? '/10' : '', met.mobility ? (log.length ? log.length + ' stretch readings' : 'your rating') : 'not rated yet', met.mobility ? met.mobility * 10 : null)}
        <button class="mt-btn" data-act="tendon-why" data-slug="${slug}" aria-label="How tendon capacity is estimated">${tile(tCap === null ? 'rgba(235,240,245,.5)' : tCap >= 65 ? '#30d158' : tCap >= 52 ? '#40c8e0' : '#ffb340', 'Tendon capacity', tCap === null ? '—' : tCap, tCap === null ? '' : '/100', tens.length ? (tCap <= 51 ? 'untrained baseline · ' : '') + esc(tens.map(x => x.name.replace(/ tendon$/i, '')).join(' · ')) : 'no tendon mapped', tCap)}</button>
        <button class="mt-btn" data-act="ar-why" data-slug="${slug}" aria-label="Why this androgen-receptor estimate">${tile('#bf5af2', 'AR sensitivity', tm ? tm.ar : '—', tm ? '/100' : '', tm && tm.arDrivers[0] ? (tm.arDrivers[0].d > 0 ? '▲ ' : '▼ ') + esc(tm.arDrivers[0].label) : 'estimate · tap for why', tm ? tm.ar : null)}</button>
        ${tile(zc, 'Weekly volume', tm ? fmt1(tm.weekSets) : (m.weekSets || 0), ' sets', tm ? esc(tm.zone) : 'hard sets, 7 days', tm ? tm.weekSets / 20 * 100 : null)}
        ${tile(st[1], 'Recovery', m.hoursSince == null ? '—' : ago(m.hoursSince).replace(' ago', ''), '', 'since last trained · ' + st[0].toLowerCase(), null)}
      </div>
      ${tm && tm.lag ? `<div class="target hint" style="margin:10px 0 0">${icon('bolt', 16)}<div><b>Strength is ahead of the tendons</b><span>Muscle adapts in weeks, tendon in months. Add load slowly here and keep some slow, heavy reps; collagen + vitamin C before training may help.</span></div></div>` : ''}
      ${tens.length ? `<div class="grp-h" style="margin-top:16px">Tendons & joints</div><section class="list frost">${tens.map(x => `<div class="li"><span class="tx"><div class="tt">${esc(x.name)}</div>
        <div class="st"><span style="color:${TST[x.status][1]}">${TST[x.status][0]}</span>${x.acwr !== null ? ' · load ratio ' + x.acwr : ''}${x.collagenSessions ? ' · ' + x.collagenSessions + '× collagen + C' : ''}</div></span>
        <b class="num">${x.capacity}</b></div>`).join('')}</section>` : ''}
      <div class="hist7" style="margin-top:14px">${days.map(k => `<span class="${hits.has(k) ? 'hit' : ''} ${k === t ? 't' : ''}"><i></i>${fmtDay(k, { weekday: 'narrow' })}</span>`).join('')}</div>
      <div class="blk"><div class="blk-h"><span class="eyebrow">Soreness</span><span class="val">${SORE_LBL[met.soreness || 0]}</span></div>
        <div class="sore">${SORE_LBL.map((l, i) => `<button class="${(met.soreness || 0) === i && (i > 0 || met.soreTs) ? 'on' : ''}" style="--sc:${SORE_COLORS[i]}" data-act="ms-sore" data-slug="${slug}" data-v="${i}">${l.toUpperCase()}</button>`).join('')}</div>
        <p>A verdict newer than your last workout overrides the recovery colours — mark None to say it has recovered.</p></div>
      ${moves.length ? `<div class="grp-h">Best exercises for it</div><div class="chips">${moves.map(x => `<button class="chip" data-act="ex-hist" data-n="${esc(x.n)}">${logged.has(x.n) ? '★ ' : ''}${esc(x.n)}</button>`).join('')}</div>` : ''}
      <details class="adj"><summary>Adjust ratings</summary>
        <div class="blk"><div class="blk-h"><span class="eyebrow">Strength rating</span><span class="val">${met.strength ? met.strength + '/10' : 'derived'}</span></div>
          ${rate('strength', '#30d158', met.strength || 0)}
          <p>Derived from 30-day tonnage (${Math.round(vol).toLocaleString()} kg): ${fmt1(m.strengthDerived || 0)}/10. A rating here overrides it; – goes back to derived.</p></div>
        <div class="blk"><div class="blk-h"><span class="eyebrow">Mobility</span><span class="val">${met.mobility ? met.mobility + '/10' : 'not rated'}</span></div>
          ${rate('mobility', '#40c8e0', met.mobility || 0)}
          <div class="row" style="margin-top:10px"><button class="btn sm btn-tint" style="--accent:#40c8e0" data-act="ms-stretch" data-slug="${slug}" ${met.mobility ? '' : 'disabled'}>${icon('clock', 15)} Log stretch reading</button>
            <span class="sub">${log.length ? log.length + ' readings' : 'no readings yet'}</span></div>
          ${log.length ? `<div class="moblog">${log.map(x => `<i style="height:${Math.max(3, x.v * 3.4)}px" title="${x.v}/10"></i>`).join('')}</div>` : ''}</div>
      </details>
      ${bio.act ? `<details class="adj"><summary>Anatomy</summary><dl class="anat">
        <dt>Action</dt><dd>${esc(bio.act)}</dd>${bio.org ? `<dt>Origin</dt><dd>${esc(bio.org)}</dd>` : ''}${bio.ins ? `<dt>Insertion</dt><dd>${esc(bio.ins)}</dd>` : ''}
        ${bio.ant ? `<dt>Antagonist</dt><dd>${esc(bio.ant)}</dd>` : ''}${bio.ft != null ? `<dt>Fibre type</dt><dd>~${bio.ft}% fast-twitch</dd>` : ''}</dl>
        ${bio.note ? `<p style="font-size:.8rem;color:var(--t2)">${esc(bio.note)}</p>` : ''}</details>` : ''}
      <p class="sub" style="line-height:1.45;margin:12px 0 0">Tendon capacity and AR sensitivity are model estimates from the sets you logged and each exercise's loading, adjusted by sleep, protein and the hormone estimate — not measurements.</p>
      <div class="row" style="gap:8px;margin-top:14px">
        <button class="btn btn-prominent" style="flex:1;--accent:#ff9f0a" data-act="train-slug" data-slug="${slug}">${icon('dumbbell', 17)} Train ${esc(m.name || '')}</button>
        <button class="btn btn-glass" data-act="ms-pin" data-slug="${slug}">${pinned ? 'Unpin' : 'Pin'}</button></div>`;
    },
  });
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
          <p class="sub" style="line-height:1.5;margin-top:12px">Your best estimated 1-rep max (Epley, from sets of up to 20 reps) divided by body weight, compared with population lifting standards for that movement — e.g. an intermediate man benches about his body weight, squats 1.5× and deadlifts about 1.9×; women's standards are ~72 % (upper body) and ~82 % (lower body) of those. Strength holds for ~3 weeks without training, then fades slowly. Dumbbells count per hand.</p>`;
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

/* ══════════════ actions ══════════════ */
const ROUND = Object.fromEntries(VIT.map(x => [x.f, x.round || 1]));
const RANGE = { sleep: [0, 14], deep: [0, 6], prot: [0, 500], water: [0, 10], weight: [30, 250], steps: [0, 100000], cal: [0, 10000] };
export const actions = {
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
  'ba-jump'(d) {
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
  'vit-step'(d) {
    const t = today(), v = view(), b = v.bio[t] || {};
    let cur = b[d.f];
    const x = VIT.find(q => q.f === d.f);
    if (cur == null) cur = d.f === 'weight' ? (latestWeight(v) || 75) : (x && x.seed) || 0;
    const r = ROUND[d.f] || 1, rg = RANGE[d.f] || [0, 1e6];
    const nv = Math.max(rg[0], Math.min(rg[1], Math.round((cur + Number(d.d)) / r) * r));
    haptic(); bioPatch(t, { [d.f]: Math.round(nv * 100) / 100 });
  },
  'vit-clear'(d) { bioPatch(today(), { [d.f]: null }); },
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
