/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Mental State (logic/src/mind.ts).

   A brain map instead of an emoji: seven regions whose activity the mind
   model estimates from sleep pressure and the body clock (Borbély's
   two-process model), the caffeine and alcohol actually in you (dose times),
   light, cold, meditation, training, your check-in, HRV and the endocrine
   estimate. Every state lists what moved it. Estimates, not measurements.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, emit, changed, esc, icon, today, fmtDay, haptic, openSheet, topSheet, closeSheet } from './core.js';
import { bioPatch, MOODS } from './views.js';
import { bedtimeTonight } from './doses.js';
import * as ART from './brain-art.js';

const H = 3600e3;
const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const STATES = [['focus', 'Focus', '#40c8e0'], ['drive', 'Drive', '#ff9f0a'], ['calm', 'Calm', '#30d158'], ['mood', 'Mood', '#bf5af2'], ['energy', 'Energy', '#ffd60a'], ['resilience', 'Resilience', '#5e5ce6']];
const REGION_COL = { pfc: '#40c8e0', striatum: '#ff9f0a', amygdala: '#ff453a', hippocampus: '#bf5af2', hypothalamus: '#ffd60a', scn: '#64d2ff', brainstem: '#30d158' };

/** What the mind model needs, read from the snapshot and this phone's queue. */
export function mindInput(now = Date.now()) {
  const v = view(), t = today(), b = v.bio[t] || {};
  const day = n => L.shiftDayKey(t, -n);
  const sleepHours = [0, 1, 2, 3].map(i => (v.bio[day(i)] || {}).sleep || 0);
  const wakeH = typeof b.wake === 'number' ? b.wake : 7;
  const mid = new Date(); mid.setHours(0, 0, 0, 0);
  const wake = mid.getTime() + wakeH * H;
  const beh = L.behaviourOn(t, v.habits, v.habitLog, v.dayRoutines || L.DEFAULT_DAY_ROUTINES, v.routineLog || {});
  const D = v.doses || [];
  const dayTot = k => L.dailyTotals(k, D, t, 60, x => L.dayKey(new Date(x)));
  const trained = k => v.workouts.some(w => w.date === k);
  const hrvs = []; for (let i = 1; i <= 30; i++) { const x = (v.bio[day(i)] || {}).hrv; if (x > 0) hrvs.push(x); }
  hrvs.sort((a, c) => a - c);
  const axes = (v.endo && v.endo.axes) || [], sc = k => { const a = axes.find(x => x.k === k); return a ? a.score : undefined; };
  // consistency over 30 days
  let med = 0, cold = 0, tr = 0; const beds = [];
  for (let i = 0; i < 30; i++) {
    const k = day(i), e = L.behaviourOn(k, v.habits, v.habitLog, v.dayRoutines || [], v.routineLog || {});
    if (e.meditation > 0) med++; if (e.cold > 0) cold++; if (trained(k)) tr++;
    const bd = (v.bio[k] || {}).bed; if (typeof bd === 'number') beds.push(bd < 12 ? bd + 24 : bd);
  }
  const sd = beds.length >= 4 ? Math.sqrt(beds.reduce((a, x, _, A) => a + (x - A.reduce((p, q) => p + q, 0) / A.length) ** 2, 0) / beds.length) : null;
  return {
    now, wake, bedtime: bedtimeTonight(), sleepHours,
    checkin: { mood: b.mood ?? null, energy: b.energy ?? null, stress: b.stress ?? null },
    doses: D, daylight: (b.daylight || 0) + beh.sunlight, cold: beh.cold, meditation: (b.mindful || 0) + beh.meditation,
    trainedToday: trained(t), trainedYesterday: trained(day(1)),
    sick: !!b.sick,
    ashwagandha: L.builtEffect(dayTot('ashwa'), 600),
    hrv: b.hrv || null, hrvBaseline: hrvs.length >= 3 ? hrvs[Math.floor(hrvs.length / 2)] : null,
    endo: { dopamineTone: sc('dopamineTone'), cortisol: sc('cortisol'), thyroid: sc('thyroid'), testosterone: sc('testosterone') },
    consistency: { meditation: med, cold, training: tr, sleepRegularity: sd === null ? 0.5 : Math.max(0, Math.min(1, 1 - (sd - 0.25) / 1.5)) },
  };
}
let cache = null, cacheKey = '';
export function mindNow() {
  const v = view(), key = (v.rev || 0) + ':' + state.pending.length + ':' + Math.floor(Date.now() / 300e3);
  if (cache && key === cacheKey) return cache;
  cache = L.mind(mindInput()); cacheKey = key;
  return cache;
}

/* ── the brain: a holographic side view (outline, surface folds, cerebellum, brainstem) with a
   glowing node for each region the model estimates and the real pathways between them. The
   surface is static line art from tools/gen-brain-art.mjs; only the selected node animates
   (opacity and transform — no SVG filters, which re-rasterise on every frame on a phone). ── */
const NODES = {
  pfc: [116, 104], striatum: [206, 116], hypothalamus: [198, 158], scn: [172, 176],
  amygdala: [148, 198], hippocampus: [226, 202], brainstem: [229, 266],
};
/** Pathways, each a real circuit: [from, to, name, bend]. */
const PATHS = [
  ['brainstem', 'striatum', 'Dopamine: midbrain → striatum (drive, reward)', -26],
  ['striatum', 'pfc', 'Cortico-striatal loop (focus, habits)', -30],
  ['brainstem', 'pfc', 'Noradrenaline: locus coeruleus → cortex (arousal)', -70],
  ['amygdala', 'hypothalamus', 'Stress: amygdala → HPA axis (cortisol)', -10],
  ['scn', 'hypothalamus', 'Body clock → hormone timing', 8],
  ['hippocampus', 'pfc', 'Memory → planning', 40],
  ['amygdala', 'pfc', 'Emotion ↔ self-control', 24],
];
const SHORT = { pfc: 'Prefrontal', striatum: 'Striatum', amygdala: 'Amygdala', hippocampus: 'Hippocampus', hypothalamus: 'Hypothalamus', scn: 'Body clock', brainstem: 'Brainstem' };
const ANATOMY = { cerebellum: { name: 'Cerebellum', info: 'Balance, coordination and the timing of movement — it fine-tunes every lift.' } };
let sel = 'pfc';
const curve = (a, b, bend) => {
  const [x1, y1] = NODES[a], [x2, y2] = NODES[b], mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const dx = x2 - x1, dy = y2 - y1, n = Math.hypot(dx, dy) || 1;
  return `M${x1} ${y1}Q${(mx - dy / n * bend).toFixed(1)} ${(my + dx / n * bend).toFixed(1)} ${x2} ${y2}`;
};
function brainSvg(M) {
  const on = k => PATHS.some(p => (p[0] === sel || p[1] === sel) && (p[0] === k || p[1] === k));
  const paths = PATHS.map(([a, b, name, bend]) => {
    const hot = a === sel || b === sel;
    return `<path class="bn-path${hot ? ' hot' : ''}" d="${curve(a, b, bend)}" style="--pc:${REGION_COL[hot ? sel : a]}"><title>${esc(name)}</title></path>`;
  }).join('');
  const nodes = Object.keys(NODES).map(k => {
    const [x, y] = NODES[k], v = M.regions[k].v, s = sel === k;
    const core = (3.2 + v / 100 * 3.2).toFixed(1), glow = (0.18 + v / 100 * 0.5).toFixed(2);
    return `<g class="bn${s ? ' sel' : ''}${!s && on(k) ? ' link' : ''}" data-act="mind-region" data-k="${k}" role="button" tabindex="0" aria-label="${esc(L.REGIONS[k].name)}: ${v}" style="--nc:${REGION_COL[k]}">
      <circle class="bn-hit" cx="${x}" cy="${y}" r="20"/>
      <circle class="bn-halo" cx="${x}" cy="${y}" r="15" style="opacity:${glow}"/>
      <circle class="bn-ring" cx="${x}" cy="${y}" r="9"/>
      <circle class="bn-core" cx="${x}" cy="${y}" r="${core}"/>
      ${s ? `<circle class="bn-pulse" cx="${x}" cy="${y}" r="12"/>` : ''}
    </g>`;
  }).join('');
  const [sx, sy] = NODES[sel] || [0, 0];
  // Labels in the crowded middle go to the left, so they never cover a neighbouring node.
  const left = sel === 'scn' || sel === 'amygdala';
  const tag = NODES[sel] ? `<g class="bn-tag" transform="translate(${left ? sx - 14 : sx + 14} ${sy - (left ? 12 : 16)})"><text text-anchor="${left ? 'end' : 'start'}">${esc(SHORT[sel])} <tspan>${M.regions[sel].v}</tspan></text></g>` : '';
  return `<svg class="brain3" viewBox="50 12 330 300" role="group" aria-label="Brain map — tap a glowing region">
    <defs>
      <radialGradient id="b3-fill" cx="42%" cy="38%" r="70%"><stop offset="0" stop-color="#16384a"/><stop offset=".65" stop-color="#0d2030"/><stop offset="1" stop-color="#08131d"/></radialGradient>
      <linearGradient id="b3-stem" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#143244"/><stop offset="1" stop-color="#0a1823"/></linearGradient>
      <clipPath id="b3-cx"><path d="${ART.CORTEX}"/></clipPath><clipPath id="b3-cb"><path d="${ART.CEREB}"/></clipPath>
    </defs>
    <path class="b3-halo" d="${ART.CORTEX}"/>
    <path class="b3-solid${sel === 'brainstem' ? ' on' : ''}" d="${ART.STEM}"/>
    <g data-act="mind-region" data-k="cerebellum" role="button" tabindex="0" aria-label="Cerebellum" class="b3-cb${sel === 'cerebellum' ? ' sel' : ''}">
      <path class="b3-solid" d="${ART.CEREB}"/><path class="b3-fol" d="${ART.FOLIA}" clip-path="url(#b3-cb)"/></g>
    <path class="b3-cortex" d="${ART.CORTEX}"/>
    <path class="b3-gyri" d="${ART.GYRI}" clip-path="url(#b3-cx)"/>
    <path class="b3-land" d="${ART.LANDMARKS}" clip-path="url(#b3-cx)"/>
    <path class="b3-rim" d="${ART.CORTEX}"/>
    ${paths}${nodes}${tag}
  </svg>`;
}
function brainLegend(M) {
  return `<div class="br-leg">${Object.keys(SHORT).map(k => `<button class="${sel === k ? 'on' : ''}" data-act="mind-region" data-k="${k}" style="--rc:${REGION_COL[k]}"><i></i>${SHORT[k]}<b class="num">${M.regions[k].v}</b></button>`).join('')}</div>`;
}
/** The selected part's read-out, under the brain — like the muscle panel on the body. */
function brainPanel(M) {
  if (ANATOMY[sel]) return `<div class="bz-panel"><div class="bz-ph"><b>${esc(ANATOMY[sel].name)}</b><span class="sub">anatomy</span></div>
    <p>${esc(ANATOMY[sel].info)}</p><p class="sub">ARK doesn't estimate this part — tap a glowing region for a live estimate.</p></div>`;
  const R = L.REGIONS[sel], r = M.regions[sel];
  if (!R || !r) return '';
  const links = PATHS.filter(p => p[0] === sel || p[1] === sel).map(p => p[2]);
  return `<div class="bz-panel" style="--rc:${REGION_COL[sel]}"><div class="bz-ph"><span class="bz-v num">${r.v}</span><div><b>${esc(R.name)}</b><div class="sub">${esc(R.state)}</div></div></div>
    <p>${esc(R.role)}</p>
    ${r.drivers.length ? `<div class="bz-dr">${r.drivers.slice(0, 4).map(x => `<div><span>${esc(x.label)}</span><b class="num" style="color:${x.d > 0 ? '#30d158' : '#ff6b5a'}">${x.d > 0 ? '+' : ''}${x.d}</b></div>`).join('')}</div>` : '<p class="sub">Nothing is moving it away from its baseline today.</p>'}
    ${links.length ? `<div class="bz-links">${links.map(l => `<span>${esc(l)}</span>`).join('')}</div>` : ''}</div>`;
}

function alertChart(M) {
  const c = M.alert.curve; if (c.length < 2) return '';
  const W = 320, h = 96, x0 = c[0].t, x1 = c[c.length - 1].t, now = Date.now();
  const X = t => 4 + (t - x0) / (x1 - x0) * (W - 8), Y = v => h - 16 - v / 100 * (h - 26);
  const line = c.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
  const best = M.alert.best, cut = M.alert.caffeineCutoff;
  const hours = []; for (let t = Math.ceil(x0 / (3 * H)) * 3 * H; t <= x1; t += 3 * H) hours.push(t);
  return `<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:${h}px" preserveAspectRatio="none" role="img" aria-label="Estimated alertness across today">
    ${best ? `<rect x="${X(best.from)}" y="2" width="${X(best.to) - X(best.from)}" height="${h - 18}" fill="rgba(64,200,224,.12)" rx="4"/>` : ''}
    ${cut && cut > x0 && cut < x1 ? `<line x1="${X(cut)}" x2="${X(cut)}" y1="2" y2="${h - 16}" stroke="#ff9f0a" stroke-width="1.2" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>` : ''}
    <path d="${line}" fill="none" stroke="#40c8e0" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    ${now > x0 && now < x1 ? `<circle cx="${X(now)}" cy="${Y(M.alert.now)}" r="4" fill="#fff"/>` : ''}
    ${hours.map(t => `<text x="${X(t).toFixed(1)}" y="${h - 2}" text-anchor="middle" font-size="9" fill="rgba(235,240,245,.45)" font-family="system-ui">${hm(t).slice(0, 2)}</text>`).join('')}</svg>`;
}

/** Mental State on Body Arch. */
export function secMind(v) {
  const t = today(), d = v.bio[t] || {}, D = v.bioDefs || {};
  const M = mindNow();
  const levels = D.levels && D.levels.length ? D.levels : MOODS.map(m => ({ e: m[0], n: m[1].toUpperCase(), d: '', c: '#5ee6b5' }));
  const top = STATES.map(([k]) => [k, M.states[k].v]).sort((a, b) => b[1] - a[1]);
  let H0 = `<section class="card frost mind-card">
    <div class="mind-sum"><div><div class="eyebrow">Right now</div><div class="mind-big num">${M.alert.now}<small>alertness</small></div></div>
      <div class="sub">Sleep pressure <b style="color:var(--t1)">${M.alert.pressure}%</b><br>Strongest <b style="color:var(--t1)">${esc(STATES.find(s => s[0] === top[0][0])[1])}</b></div></div>
    <div class="brain-stage"><span class="b3-hud l">SAGITTAL · LEFT</span><span class="b3-hud r">NEURAL ACTIVITY</span>${brainSvg(M)}<div class="fig-hint">Tap a glowing region</div></div>
    ${brainLegend(M)}
    ${brainPanel(M)}
    <div class="mind-states">${STATES.map(([k, n, c]) => { const s = M.states[k], dr = s.drivers[0];
      return `<button class="ms-t" style="--c:${c}" data-act="mind-state" data-k="${k}"><span class="n">${n}</span><b class="num">${s.v}</b>
        <span class="bar"><i style="width:${s.v}%"></i></span><span class="why">${dr ? (dr.d > 0 ? '▲ ' : '▼ ') + esc(dr.label) : 'no strong driver'}</span></button>`; }).join('')}</div>
    <p class="sub" style="margin:10px 0 0;line-height:1.45">Model estimates (0–100) from sleep, body clock, what's in you, light, cold, training and your check-in — tap a region or state to see why.</p></section>`;

  const A = M.alert, bed = bedtimeTonight();
  H0 += `<section class="card frost" style="margin-top:10px"><div class="card-h"><span class="t">Focus today</span><span class="k">two-process model</span></div>
    ${alertChart(M)}
    <div class="mind-tips">
      ${A.best ? `<div><span class="dot" style="background:#40c8e0"></span>Best focus <b>${hm(A.best.from)}–${hm(A.best.to)}</b></div>` : ''}
      ${A.dip ? `<div><span class="dot" style="background:#8e8e93"></span>Afternoon dip ~<b>${hm(A.dip)}</b></div>` : ''}
      ${A.caffeineCutoff ? `<div><span class="dot" style="background:#ff9f0a"></span>Last 100 mg coffee by <b>${hm(A.caffeineCutoff)}</b> for a ${hm(bed)} bedtime</div>` : ''}
      <div><span class="dot" style="background:${A.caffeineAtBed > 50 ? '#ff453a' : A.caffeineAtBed > 25 ? '#ffb340' : '#30d158'}"></span>Caffeine at bedtime <b>~${A.caffeineAtBed} mg</b>${A.caffeineAtBed > 25 ? ' — enough to cost deep sleep' : ''}</div>
    </div></section>`;

  const days = [6, 5, 4, 3, 2, 1, 0].map(i => L.shiftDayKey(t, -i));
  const moods = days.map(k => (v.bio[k] || {}).mood);
  const lv = d.mood != null ? levels[d.mood] : null;
  const scale = (f, c, cur) => `<div class="scale fill">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => `<button class="${cur === n ? 'on' : ''}" style="--c:${c}" data-act="bio-set" data-f="${f}" data-v="${n}">${n}</button>`).join('')}</div>`;
  H0 += `<div class="ba-h"><h2 style="font-size:1.05rem">Check in</h2><span class="k">${lv ? esc(lv.n) : 'how are you, really?'}</span></div>
    <section class="card frost tight">
      <div class="eyebrow" style="margin-bottom:8px">Mood</div>
      <div class="moods">${levels.map((m, i) => `<button class="${d.mood === i ? 'on' : ''}" style="--c:${m.c}" data-act="bio-set" data-f="mood" data-v="${i}" aria-label="${esc(m.n)}">${m.e}</button>`).join('')}</div>
      <div class="row" style="margin:14px 0 8px"><span class="eyebrow" style="flex:1">Energy</span><span class="sub num">${d.energy ? d.energy + ' / 10' : ''}</span></div>${scale('energy', '#ffd60a', d.energy)}
      <div class="row" style="margin:14px 0 8px"><span class="eyebrow" style="flex:1">Stress</span><span class="sub num">${d.stress ? d.stress + ' / 10' : ''}</span></div>${scale('stress', '#bf5af2', d.stress)}
      <div class="nlog">${days.map((k, i) => { const m = moods[i], c = m != null && levels[m] ? levels[m].c : '';
        return `<span><i style="height:${m != null ? 12 + m * 7 : 4}px;${c ? 'background:' + c : ''}"></i>${fmtDay(k, { weekday: 'narrow' })}</span>`; }).join('')}</div>
    </section>`;
  return H0;
}

/** The small read-out for Today. */
export function mindGlance() {
  const M = mindNow(), A = M.alert, f = M.states.focus;
  return `<section class="card frost glance" data-act="tab" data-tab="body" role="button" tabindex="0">
    <div class="card-h"><span class="t">${icon('brain', 17)} Mind</span><span class="k">estimate</span></div>
    <div class="gl3"><div><b class="num">${f.v}</b><span>Focus now</span></div>
      <div><b class="num">${A.best ? hm(A.best.from) : '—'}</b><span>Best window</span></div>
      <div><b class="num">${A.caffeineCutoff ? hm(A.caffeineCutoff) : '—'}</b><span>Coffee cutoff</span></div></div></section>`;
}

function regionSheet(k) {
  const R = L.REGIONS[k];
  openSheet({
    id: 'region', title: R.name,
    render: () => {
      const r = mindNow().regions[k];
      return `<div class="row" style="gap:14px;margin-bottom:12px"><div class="reg-dot" style="--rc:${REGION_COL[k]}"><b class="num">${r.v}</b></div>
        <div style="flex:1"><div class="eyebrow">${esc(R.state)}</div><p style="margin:4px 0 0;line-height:1.45;color:var(--t2)">${esc(R.role)}</p></div></div>
        ${drivers(r.drivers)}`;
    },
  });
}
function drivers(ds) {
  return ds.length ? `<div class="grp-h">What moved it</div><section class="list frost">${ds.map(x => `<div class="li"><span class="tx"><div class="tt">${esc(x.label)}</div></span>
    <b class="num" style="color:${x.d > 0 ? '#30d158' : '#ff6b5a'}">${x.d > 0 ? '+' : ''}${x.d}</b></div>`).join('')}</section>`
    : '<div class="empty">Nothing is pushing this one away from its baseline today.</div>';
}
const STATE_NOTE = {
  focus: 'Alertness from sleep pressure and the body clock, minus sleep debt, stress and illness. Peaks a few hours after waking and again in the early evening.',
  drive: 'Motivation — dopamine tone. Cold, morning light, training and a good mood raise it; sleep debt and yesterday\'s alcohol lower it.',
  calm: 'The opposite of stress load. Meditation, theanine, ashwagandha (built over weeks) and a higher HRV help; high cortisol and a lot of caffeine cost it.',
  mood: 'Your own check-in counts most; daylight, training and sleep make up the rest.',
  energy: 'How alert you are right now blended with how you said you feel, adjusted by the thyroid estimate.',
  resilience: 'Built over weeks, not days: regular meditation, cold, training and a regular sleep schedule.',
};
function stateSheet(k) {
  const s0 = STATES.find(s => s[0] === k);
  openSheet({ id: 'mstate', title: s0[1], render: () => { const s = mindNow().states[k];
    return `<div class="row" style="gap:14px;margin-bottom:12px"><div class="reg-dot" style="--rc:${s0[2]}"><b class="num">${s.v}</b></div>
      <p style="flex:1;margin:0;line-height:1.45;color:var(--t2)">${esc(STATE_NOTE[k])}</p></div>${drivers(s.drivers)}`; } });
}

export const actions = {
  'mind-region'(d) { haptic(); sel = d.k; changed(); },
  'mind-state'(d) { haptic(); stateSheet(d.k); },
  'mind-sick'() { haptic(); const t = today(); bioPatch(t, { sick: (view().bio[t] || {}).sick ? null : 1 }); },
};
