/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Train. Laid out like Strong: quick start, templates, a
   workout screen with SET · PREVIOUS · KG · REPS · ✓ rows, a rest timer
   that stays in view, an exercise library, history.

   A finished workout is one `workout.add` event carrying a session in the
   shape the desktop logger (swFinish) writes, so Body Arch, TRAIN NEXT,
   records and Progress treat it as if it had been logged on the PC. Extra
   per-set fields (rpe, type d/f) and per-exercise ones (warm, note, ss) ride
   along; the PC keeps them and its maths ignores them.
   ══════════════════════════════════════════════════════════════════════ */
import { planCard, planNow } from './system.js';
import {
  L, state, view, emit, emitUndoable, changed, esc, icon, today, fmt1, fmtDay, uid, toast, haptic, chime, unlockAudio, daysBetween,
  openSheet, closeSheet, topSheet, barsSvg, sparkSvg, hubBase,
} from './core.js';
import { GROUPS, trainNext, syncButton } from './views.js';

const BLUE = '#0a84ff', GREEN = '#30d158';
const GRP_KEY_FALLBACK = {
  chest: { g: 'Chest', c: 'push', m: ['chest'] }, back: { g: 'Back', c: 'pull', m: ['upper-back'] },
  shoulders: { g: 'Shoulders', c: 'push', m: ['deltoids'] }, arms: { g: 'Arms', c: 'pull', m: ['biceps'] },
  legs: { g: 'Legs', c: 'legs', m: ['quadriceps'] }, core: { g: 'Core', c: 'core', m: ['abs'] },
};
const grpKeys = () => (view().exGroups && Object.keys(view().exGroups).length ? view().exGroups : GRP_KEY_FALLBACK);
const unit = () => view().unit || 'kg';
const EQUIP = [['all', 'All'], ['barbell', 'Barbell'], ['dumbbell', 'Dumbbell'], ['machine', 'Machine'], ['cable', 'Cable'], ['bodyweight', 'Bodyweight'], ['other', 'Other']];
const EQUIP_LBL = { barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', kettlebell: 'Kettlebell', band: 'Band', smith: 'Smith', ez: 'EZ bar', trap: 'Trap bar', plate: 'Plate', other: 'Other' };

/* ── history reads ── */
/** Working sets from the last session with this exercise, under any of its names. */
function lastSetsFor(name) { const e = lastExFor(name); return e ? e.sets : null; }
function lastExFor(name) {
  const ws = view().workouts, skip = state.workout && state.workout.edit ? state.workout.edit.key : null;
  for (let i = ws.length - 1; i >= 0; i--) {
    if (skip && (ws[i].id || ws[i].ts) === skip) continue;
    const e = (ws[i].exercises || []).find(x => L.sameExercise(x.n, name));
    if (e && e.sets && e.sets.length) return e;
  }
  return null;
}
let libCache = null, libKey = '';
/** The full library (logic/exercises.ts) plus your own, under the names your history already uses. */
function library() {
  const v = view();
  const key = (v.rev || 0) + ':' + v.workouts.length + ':' + (v.exercises || []).length;
  if (libCache && libKey === key) return libCache;
  const logged = new Set();
  v.workouts.forEach(w => (w.exercises || []).forEach(e => logged.add(e.n)));
  (v.routines || []).forEach(r => (r.ex || []).forEach(e => logged.add(e.n)));
  const extra = [...(v.exercises || [])];
  v.workouts.forEach(w => (w.exercises || []).forEach(e => extra.push({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' })));
  libCache = L.mergedLibrary(extra, [...logged]).sort((a, b) => a.n.localeCompare(b.n));
  libKey = key;
  return libCache;
}
function prs(ws) {
  const pr = {};
  ws.forEach(s => (s.exercises || []).forEach(e => (e.sets || []).forEach(st => {
    const w = +st.w || 0, r = +st.r || 0; if (w <= 0 || r <= 0) return;
    const o = L.e1rm(w, r);
    if (!pr[e.n] || o > pr[e.n].orm) pr[e.n] = { w, r, orm: o, date: s.date };
  })));
  return pr;
}
const fmtDur = secs => { const h = Math.floor(secs / 3600), m = Math.floor(secs % 3600 / 60), s = secs % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtMinS = secs => Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
const defaultName = () => { const h = new Date().getHours(); return h < 11 ? 'Morning Workout' : h < 17 ? 'Afternoon Workout' : 'Evening Workout'; };

/* ── the training-load read-out (logic/tissue.ts) ── */
let tissueCache = null, tissueKey = '';
export function tissueNow() {
  const v = view(), t = today();
  const key = t + ':' + (v.rev || 0) + ':' + state.pending.length;
  if (tissueCache && tissueKey === key) return tissueCache;
  const axes = ((v.endo || {}).axes || []), sc = k => { const a = axes.find(x => x.k === k); return a ? a.score : undefined; };
  const nights = [0, 1, 2, 3, 4, 5, 6].map(i => (v.bio[L.shiftDayKey(t, -i)] || {}).sleep).filter(x => x > 0);
  const prot = [0, 1, 2, 3, 4, 5, 6].map(i => (v.bio[L.shiftDayKey(t, -i)] || {}).prot).filter(x => x > 0);
  const goalP = ((v.bioDefs || {}).goals || {}).prot || 150;
  const strength = {}; (v.body.muscles || []).forEach(m => { if (m.strength != null) strength[m.slug] = m.strength; });
  const age = (L.specimen(v.profile || {}) || {}).age;
  const wk = Object.keys(v.weights || {}).sort().pop(), bodyweight = wk ? v.weights[wk] : (v.profile || {}).weight || null;
  tissueCache = L.tissue({ sessions: v.workouts, today: t, doses: v.doses || [], strength, age: age == null ? null : age,
    bodyweight: bodyweight ? Number(bodyweight) : null, sex: (v.profile || {}).sex || null,
    endo: { testosterone: sc('testosterone'), growthHormone: sc('growthHormone'), igf1: sc('igf1'), cortisol: sc('cortisol') },
    sleepAvg: nights.length ? nights.reduce((a, b) => a + b, 0) / nights.length : null,
    proteinRatio: prot.length ? prot.reduce((a, b) => a + b, 0) / prot.length / goalP : null });
  tissueKey = key;
  return tissueCache;
}
const acwrLabel = r => r === null ? ['not enough history', 'var(--t3)'] : r > 1.5 ? ['spike — ramping faster than you adapt', '#ff453a']
  : r > 1.3 ? ['ramping up', '#ffb340'] : r >= 0.8 ? ['steady', GREEN] : ['lighter than usual', '#40c8e0'];
const MNAME = s => (window.ARK_MNAME || {})[s] || s;

function loadCard() {
  const v = view();
  if (!v.workouts.length) return '';
  const T = tissueNow();
  const ms = Object.values(T.muscles).filter(m => m.weekSets > 0 || m.chronicSets > 0).sort((a, b) => b.weekSets - a.weekSets).slice(0, 8);
  const lab = acwrLabel(T.acwr);
  const alerts = Object.values(T.tendons).filter(x => x.status === 'spike');
  const max = Math.max(22, ...ms.map(m => m.weekSets));
  return `<section class="card frost tl-card" data-act="load-sheet" role="button" tabindex="0" aria-label="Training load details">
    <div class="card-h"><span class="t">Training load</span><span class="k">hard sets · last 7 days</span></div>
    ${ms.length ? `<div class="ld">${ms.map(m => `<div class="ld-r"><span>${esc(MNAME(m.slug))}</span>
      <span class="ld-t"><i class="z1" style="left:${10 / max * 100}%"></i><i class="z1" style="left:${20 / max * 100}%"></i>
        <b style="width:${Math.min(100, m.weekSets / max * 100)}%;background:${m.weekSets >= 10 && m.weekSets <= 20 ? GREEN : m.weekSets > 20 ? '#ffb340' : BLUE}"></b></span>
      <span class="num">${fmt1(m.weekSets)}</span></div>`).join('')}</div>
      <div class="sub" style="margin-top:6px">Markers at 10 and 20: the range where weekly sets grow muscle best.</div>` : '<div class="sub">No hard sets in the last 7 days.</div>'}
    <div class="ld-foot"><span><b style="color:${lab[1]}">${T.acwr === null ? '—' : T.acwr}</b> load ratio · ${lab[0]}</span>
      ${T.rpe7 !== null ? `<span>RPE <b>${T.rpe7}</b>${T.rpePrev !== null ? ` <small>(was ${T.rpePrev})</small>` : ''}</span>` : ''}</div>
    ${alerts.length ? `<div class="target hint sore" style="margin:10px 0 0">${icon('heart', 16)}<div><b>${alerts.map(a => esc(a.name)).join(', ')}</b><span>Load jumped more than 50 % above your 4-week average — tendons adapt slower than muscle. Hold the load steady for a week.</span></div></div>` : ''}
  </section>`;
}
function loadSheet() {
  openSheet({
    id: 'load', title: 'Training load',
    render: () => {
      const T = tissueNow(), lab = acwrLabel(T.acwr);
      const ms = Object.values(T.muscles).sort((a, b) => b.weekSets - a.weekSets);
      const ts = Object.values(T.tendons).sort((a, b) => b.acute - a.acute);
      const stc = { spike: '#ff453a', building: '#40c8e0', steady: GREEN, detraining: '#ffb340', untrained: 'var(--t3)' };
      return `<p class="sub" style="line-height:1.5;margin:0 0 12px">From every set you logged, shared out by each exercise's muscle and tendon loading. Estimates to steer training — not measurements.</p>
        <div class="stat3"><div class="frost"><div class="v num" style="color:${lab[1]}">${T.acwr === null ? '—' : T.acwr}</div><div class="k">Load ratio</div></div>
          <div class="frost"><div class="v num">${T.rpe7 === null ? '—' : T.rpe7}</div><div class="k">RPE · 7 days</div></div>
          <div class="frost"><div class="v num">${T.arTotal}</div><div class="k">AR est. · total</div></div></div>
        <p class="sub" style="line-height:1.5;margin:10px 0 0">Load ratio = last 7 days ÷ your 4-week weekly average. 0.8–1.3 is the steady zone; above 1.5 injury risk rises in the sports literature (a debated heuristic — treat it as a caution).</p>
        <div class="sec"><h2>Muscles</h2><span class="sub">sets/wk · AR</span></div>
        <section class="list frost">${ms.map(m => `<button class="li" data-act="muscle" data-slug="${m.slug}"><span class="tx"><div class="tt">${esc(MNAME(m.slug))}</div>
          <div class="st">${fmt1(m.weekSets)} this week · ${esc(m.zone)}${m.lag ? ' · tendon behind muscle' : ''}</div></span>
          <b class="num" title="Estimated androgen-receptor sensitivity">${m.ar}</b><span class="chev">${icon('chev', 15)}</span></button>`).join('')}</section>
        <div class="sec"><h2>Tendons</h2><span class="sub">capacity</span></div>
        <section class="list frost">${ts.map(x => `<div class="li"><span class="tx"><div class="tt">${esc(x.name)}</div>
          <div class="st"><span style="color:${stc[x.status]}">${x.status}</span>${x.acwr !== null ? ' · ratio ' + x.acwr : ''}${x.collagenSessions ? ' · ' + x.collagenSessions + '× collagen + C' : ''}</div></span>
          <b class="num">${x.capacity}</b></div>`).join('')}</section>
        <p class="sub" style="line-height:1.5;margin-top:12px">Androgen-receptor sensitivity (AR) rises with training a muscle and falls back over weeks without it; high cortisol and short sleep blunt it (Ahtiainen 2011). 50 = an untrained muscle. Tendon capacity changes over months, faster with good sleep, protein and collagen + vitamin C before training.</p>`;
    },
  });
}

/* ══════════════ TRAIN TAB ══════════════ */
export function renderTrain() {
  const v = view(), t = today(), W = state.workout;
  let H = `<header class="hdr"><div><div class="hdr-eyebrow">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
    <h1 class="hdr-title">Train</h1></div><div class="hdr-acts">${syncButton()}</div></header>`;

  if (W) {
    const lbl = W.template ? 'New template' : W.edit ? 'Editing ' + fmtDay(W.edit.date, { weekday: 'short', day: 'numeric', month: 'short' }) : 'In progress';
    H += `<section class="card glass wo-live" style="margin-bottom:12px">
      <div class="row"><div style="flex:1;min-width:0"><div class="eyebrow" style="color:${BLUE}">${esc(lbl)}</div>
        <div style="font-size:1.3rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(W.name || defaultName())}</div>
        <div class="sub">${W.ex.length} exercise${W.ex.length === 1 ? '' : 's'}${W.edit || W.template ? '' : ' · <span class="num" data-elapsed></span>'}</div></div>
        <button class="btn btn-prominent" style="--accent:${BLUE}" data-act="open-workout">Resume</button></div></section>`;
  } else {
    H += `<div class="sec" style="margin-top:4px"><h2>Quick start</h2></div>
      <button class="btn btn-prominent block strong-go" style="--accent:${BLUE}" data-act="start-empty">Start an Empty Workout</button>`;
    if (!v.workouts.some(w => w.date === t)) H += planCard(v);
  }

  /* templates */
  const rs = v.routines || [];
  H += `<div class="sec"><h2>Templates</h2><button class="link" data-act="tpl-new">${icon('plus', 14)} Template</button></div>`;
  H += rs.length ? `<div class="eyebrow" style="margin:0 2px 8px">My templates (${rs.length})</div><div class="tpl-grid">${rs.map((r, i) => {
    const lastW = [...v.workouts].reverse().find(w => r.ex.length && r.ex.slice(0, 2).every(e => (w.exercises || []).some(x => L.sameExercise(x.n, e.n))));
    return `<button class="tpl frost" data-act="tpl-open" data-i="${i}"><b>${esc(r.name)}</b>
      <span class="tpl-ex">${r.ex.slice(0, 4).map(e => `${(e.sets || []).length || 3} × ${esc(e.n)}`).join('<br>')}${r.ex.length > 4 ? '<br>+' + (r.ex.length - 4) + ' more' : ''}</span>
      <span class="tpl-last">${lastW ? '⏱ ' + (daysBetween(lastW.date, t) === 0 ? 'Today' : daysBetween(lastW.date, t) + ' days ago') : ''}</span></button>`;
  }).join('')}</div>`
    : `<div class="card frost empty" style="padding:16px">Save a workout as a template, or build one with <b>+ Template</b>.</div>`;

  H += loadCard();

  /* this week */
  const ws = (() => { const [y, m, d] = t.split('-').map(Number), dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - (dt.getDay() + 6) % 7); return L.dayKey(dt); })();
  const wk = v.workouts.filter(w => w.date >= ws);
  const sets = wk.reduce((a, w) => a + w.exercises.reduce((b, e) => b + e.sets.length, 0), 0);
  const vol = wk.reduce((a, w) => a + (w.volume || 0), 0);
  H += `<div class="sec"><h2>This week</h2><button class="link" data-act="lib-open">Exercises</button></div><div class="stat3">
    <div class="frost"><div class="v num">${wk.length}</div><div class="k">Workouts</div></div>
    <div class="frost"><div class="v num">${sets}</div><div class="k">Sets</div></div>
    <div class="frost"><div class="v num">${vol >= 10000 ? fmt1(vol / 1000) + 'k' : Math.round(vol)}</div><div class="k">Volume · ${unit()}</div></div></div>`;
  if (v.workouts.length) {
    const b = L.weeklyBuckets(v.workouts.map(w => ({ date: w.ts || w.date, value: w.volume || 0 })), 8);
    H += `<section class="card frost" style="margin-top:10px"><div class="card-h"><span class="t">Weekly volume</span><span class="k">last 8 weeks</span></div>
      ${barsSvg(b.map(x => Math.round(x.total)), BLUE, 70, b.map(x => fmtDay(x.week, { day: 'numeric', month: 'short' })))}</section>`;
    const pr = prs(v.workouts), top = Object.keys(pr).sort((a, b) => pr[b].orm - pr[a].orm).slice(0, 6);
    H += `<div class="sec"><h2>Records</h2><span class="sub">est. 1RM</span></div><section class="list frost">` + top.map(n => `
      <button class="li" data-act="ex-hist" data-n="${esc(n)}" style="--c:#ffd60a"><span class="ic">${icon('trophy', 18)}</span><span class="tx"><div class="tt">${esc(n)}</div>
      <div class="st">${fmt1(pr[n].w)} ${unit()} × ${pr[n].r} · ${fmtDay(pr[n].date, { day: 'numeric', month: 'short' })}</div></span>
      <b class="num">${Math.round(pr[n].orm)}</b><span class="chev">${icon('chev', 16)}</span></button>`).join('') + `</section>`;
    H += `<div class="sec"><h2>History</h2></div><div class="stack">` + v.workouts.slice(-12).reverse().map(w => {
      const i = v.workouts.indexOf(w);
      const best = (w.exercises || []).slice(0, 3).map(e => {
        const b1 = (e.sets || []).reduce((a, s) => (L.e1rm(+s.w || 0, +s.r || 0) > L.e1rm(+a.w || 0, +a.r || 0) ? s : a), { w: 0, r: 0 });
        return `<div class="hx"><span>${(e.sets || []).length} × ${esc(e.n)}</span><span class="num">${fmt1(b1.w)} × ${b1.r}</span></div>`;
      }).join('');
      return `<button class="card frost hist" data-act="session-sheet" data-i="${i}">
        <div class="row"><b style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(w.name || (w.type ? w.type.charAt(0).toUpperCase() + w.type.slice(1) + ' day' : 'Workout'))}</b>
          <span class="sub">${fmtDay(w.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
        <div class="hm">${w.duration ? `<span>⏱ ${fmtDur(w.duration)}</span>` : ''}<span>🏋 ${Math.round(w.volume || 0).toLocaleString()} ${w.unit || unit()}</span>${w.prCount ? `<span>🏆 ${w.prCount} PR</span>` : ''}${w.src === 'phone' ? '<span>📱</span>' : ''}${w.edited ? '<span>edited</span>' : ''}</div>
        ${best}${(w.exercises || []).length > 3 ? `<div class="hx sub">+${w.exercises.length - 3} more</div>` : ''}</button>`;
    }).join('') + `</div>`;
  } else {
    H += `<div class="card frost empty" style="margin-top:10px">No workouts yet. Your first one sets the baseline every later target is built from.</div>`;
  }
  return H;
}

/* ══════════════ LIVE WORKOUT ══════════════ */
function exFromLib(n) {
  const e = library().find(x => x.n === n);
  return e ? { n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' } : null;
}
function newExercise(meta, count) {
  const last = lastSetsFor(meta.n);
  const k = Math.max(1, count || (last ? last.length : 3));
  return { ...meta, sets: Array.from({ length: k }, () => ({ w: '', r: '', done: false })) };
}
function startWith(exList, extra = {}) {
  if (state.workout) { toast('Finish or cancel the current workout first'); openWorkout(); return; }
  state.workout = { id: 'm' + uid(), start: Date.now(), ex: exList, restEnd: 0, name: defaultName(), ...extra };
  changed({ now: true });
  openWorkout();
}
/** Days since the last workout of any kind - drives the comeback deload. */
export function trainGap() {
  const ds = view().workouts.map(w => w.date).filter(Boolean).sort();
  return ds.length ? daysBetween(ds[ds.length - 1], today()) : 0;
}
/** Start today's planned session (logic/src/planner.ts): its exercises and set counts; targets come from
 *  the usual progression placeholders, and a deload plan carries its lighter weight. */
export function startPlan(P) {
  if (state.workout) { toast('Finish or cancel the current workout first'); openWorkout(); return; }
  const deload = !!(P.note && /Deload/.test(P.note));
  startWith(P.exercises.map(e => {
    const x = newExercise({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' }, e.sets);
    if (deload && e.target && e.target.w) x.deloadW = e.target.w;
    return x;
  }), { name: P.title });
}
/** Start a workout with the exercises that hit these muscles, most recently used first. */
export function startForMuscles(slugs) {
  if (state.workout) { toast('Finish or cancel the current workout first'); openWorkout(); return; }
  const ws = view().workouts;
  const lastUsed = n => { for (let i = ws.length - 1; i >= 0; i--) if ((ws[i].exercises || []).some(e => L.sameExercise(e.n, n))) return i; return -1; };
  const picks = library().filter(e => (e.m || []).slice(0, 1).some(m => slugs.includes(m)))
    .sort((a, b) => lastUsed(b.n) - lastUsed(a.n)).slice(0, 3);
  startWith(picks.map(e => newExercise({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' })));
  if (!picks.length) openPicker();
}
const isWork = s => !s.warm;
/** Index of set i among the working sets (warm-ups are not numbered and get no target). */
const workIdx = (ex, i) => ex.sets.slice(0, i).filter(isWork).length;
function placeholder(ex, i) {
  if (ex.sets[i] && ex.sets[i].warm) return { w: '', r: '', tgt: null, prev: null };
  const last = lastSetsFor(ex.n), wi = workIdx(ex, i);
  let tgt = L.progressionTarget(last, ex.e === 'dumbbell' ? 2 : state.settings.step, 12, trainGap());
  if (ex.deloadW) tgt = { w: ex.deloadW, r: tgt ? tgt.r : (last && last[wi] ? last[wi].r : 8), reason: 'Lighter session - about 90% of your recent top weight' };
  if (tgt && tgt.w && ex.e === 'barbell') {
    const u = unit() === 'lb' ? 'lb' : 'kg', bar = BARS[u].includes(state.settings.bar) ? state.settings.bar : BARS[u][0];
    const w2 = L.loadable(tgt.w, bar, PLATE_SETS[u]);
    if (Math.abs(w2 - tgt.w) > 0.01) tgt = { ...tgt, w: w2, reason: tgt.reason + ' (rounded to your plates)' };
  }
  if (tgt) return { w: fmt1(tgt.w), r: tgt.r, tgt, prev: last && last[wi] };
  return { w: '', r: '', tgt: null, prev: last && last[wi] };
}
/** Rest for this exercise: your own setting for it, else the default by kind (logic/gym.ts). */
export function restFor(ex) {
  const own = (state.settings.restByEx || {})[ex.n];
  return own > 0 ? own : L.restSeconds(ex, state.settings.rest || 90);
}
function soreSlugs() { return (view().body.muscles || []).filter(m => (m.soreness || 0) >= 2).map(m => m.slug); }
const SS_COL = ['#bf5af2', '#40c8e0', '#ff375f', '#ffd60a', '#30d158'];
const ssColor = k => SS_COL[(k.charCodeAt(0) - 65) % SS_COL.length];
function ssEnd(W, x) { const k = W.ex[x].ss; if (!k) return x; let end = x; W.ex.forEach((e, j) => { if (e.ss === k) end = Math.max(end, j); }); return end; }
function hints(ex, x) {
  let H = '';
  const dl = ex.deloadW ? null : L.deloadAdvice(view().workouts, ex.n, w => ex.e === 'barbell' ? L.loadable(w, BARS[unit() === 'lb' ? 'lb' : 'kg'][0], PLATE_SETS[unit() === 'lb' ? 'lb' : 'kg']) : Math.round(w));
  if (dl && dl.deload) H += `<div class="target hint">${icon('bolt', 16)}<div><b>Lighter session? ${fmt1(dl.weight)} ${unit()}</b><span>${esc(dl.reason)}</span>
      <button class="btn sm btn-tint" style="margin-top:8px;--accent:#ffb340" data-act="use-deload" data-x="${x}" data-w="${dl.weight}">Use ${fmt1(dl.weight)} ${unit()}</button></div></div>`;
  const sore = soreSlugs();
  const alt = sore.length ? L.swapOptions(ex, library(), sore, view().workouts) : [];
  if (alt.length) {
    const hit = (ex.m || []).filter(m => sore.includes(m)).map(m => MNAME(m));
    H += `<div class="target hint sore">${icon('heart', 16)}<div><b>${esc(hit.join(', '))} marked sore</b><span>These train the same group without it:</span>
      <div class="chips" style="margin-top:8px">${alt.map(a => `<button class="chip" data-act="swap-ex" data-x="${x}" data-n="${esc(a.n)}">${esc(a.n)}</button>`).join('')}</div></div></div>`;
  }
  return H;
}
function nextSsLetter(W) { for (let c = 65; c < 91; c++) { const k = String.fromCharCode(c); if (!W.ex.some(e => e.ss === k)) return k; } return 'Z'; }
/** What the rest-timer notification says comes next. */
export function nextSetHint() {
  const W = state.workout; if (!W) return '';
  for (const ex of W.ex) { const i = ex.sets.findIndex(s => !s.done && !s.warm); if (i >= 0) return 'Next: ' + ex.n + ' · set ' + (workIdx(ex, i) + 1); }
  return 'Time for your next set.';
}
const setLabel = (ex, i) => { const s = ex.sets[i]; return s.warm ? 'W' : s.type === 'd' ? 'D' : s.type === 'f' ? 'F' : String(workIdx(ex, i) + 1); };

function restBar() {
  const W = state.workout;
  const left = W && W.restEnd ? Math.max(0, Math.ceil((W.restEnd - Date.now()) / 1000)) : 0;
  if (!left) return '<div class="restbar" data-restbar hidden></div>';
  const total = W.restTotal || left, pct = Math.max(0, Math.min(100, (1 - left / total) * 100));
  return `<div class="restbar" data-restbar><div class="rb-top"><span class="eyebrow" style="color:${BLUE}">Rest</span>
      <span class="num rb-t" data-rest>${fmtMinS(left)}</span>
      <button class="rb-b" data-act="rest-adj" data-d="-15" aria-label="15 seconds less">−15</button>
      <button class="rb-b" data-act="rest-adj" data-d="15" aria-label="15 seconds more">+15</button>
      <button class="rb-b skip" data-act="rest-skip">Skip</button></div>
    <div class="rb-p"><i data-rest-p style="width:${pct}%"></i></div></div>`;
}
function renderWorkout() {
  const W = state.workout;
  if (!W) return '<div class="empty">No workout in progress.</div>';
  let H = restBar();
  H += `<div class="wo-head"><input class="wo-name" data-wo-name value="${esc(W.name || defaultName())}" maxlength="60" aria-label="Workout name">
    <div class="sub">${W.edit ? fmtDay(W.edit.date, { weekday: 'long', day: 'numeric', month: 'long' }) : W.template ? 'Template — nothing is logged'
      : new Date(W.start).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · <span class="num" data-elapsed></span>'}</div>
    <textarea class="wo-notes" data-wo-notes rows="1" placeholder="Notes" maxlength="400">${esc(W.notes || '')}</textarea></div>`;
  if (!W.ex.length) H += `<div class="empty">Add your first exercise.<br>Numbers from last time appear next to every set.</div>`;
  W.ex.forEach((ex, x) => {
    const lastEx = lastExFor(ex.n), p0 = placeholder(ex, ex.sets.findIndex(isWork));
    H += `<section class="ex frost${ex.ss ? ' ss' : ''}"${ex.ss ? ` style="--ssc:${ssColor(ex.ss)}"` : ''}>
      ${ex.ss ? `<div class="ss-lbl">Superset ${esc(ex.ss)}${x === ssEnd(W, x) ? ' · rest after this' : ' · straight to the next'}</div>` : ''}
      <div class="ex-h"><button class="ex-name blue" data-act="ex-menu" data-x="${x}" aria-label="${esc(ex.n)} — options"><div class="ex-n">${esc(ex.n)}</div></button>
        <button class="circle sm" data-act="ex-menu" data-x="${x}" aria-label="More for ${esc(ex.n)}">${icon('dots', 18)}</button></div>
      ${lastEx && lastEx.note ? `<div class="ex-last">Last note: ${esc(lastEx.note)}</div>` : ''}
      ${ex.note ? `<button class="ex-note" data-act="ex-note" data-x="${x}">${icon('note', 14)}<span>${esc(ex.note)}</span></button>` : ''}
      ${p0.tgt && !W.edit && !W.template ? `<div class="target">${icon('target', 16)}<div><b>Target ${p0.tgt.w ? fmt1(p0.tgt.w) + ' ' + unit() + ' × ' : ''}${p0.tgt.r}</b><span>${esc(p0.tgt.reason.replace(' - ', ' — '))}</span></div></div>` : ''}
      ${W.edit || W.template || ex.sets.some(st => st.done) ? '' : hints(ex, x)}
      <table class="sets"><thead><tr><th>Set</th><th>Previous</th><th>${unit()}</th><th>Reps</th><th>✓</th></tr></thead><tbody>`;
    ex.sets.forEach((s, i) => {
      const ph = placeholder(ex, i), n = setLabel(ex, i), lbl = s.warm ? 'Warm-up set' : 'Set ' + n;
      H += `<tr class="${s.done ? 'done' : ''}${s.warm ? ' warm' : ''}${s.type ? ' t-' + s.type : ''}"><td class="sn"><button class="snb" data-act="set-menu" data-x="${x}" data-i="${i}" aria-label="${lbl} options${s.rpe ? ', RPE ' + s.rpe : ''}">${n}${s.rpe ? `<small>@${esc(String(s.rpe))}</small>` : ''}</button></td>
        <td class="pv">${ph.prev ? fmt1(ph.prev.w) + ' × ' + ph.prev.r : '—'}</td>
        <td><input inputmode="decimal" enterkeyhint="next" data-set="w" data-x="${x}" data-i="${i}" value="${esc(s.w)}" placeholder="${esc(ph.w)}" aria-label="${lbl} weight"></td>
        <td><input inputmode="numeric" enterkeyhint="done" data-set="r" data-x="${x}" data-i="${i}" value="${esc(s.r)}" placeholder="${esc(ph.r)}" aria-label="${lbl} reps"></td>
        <td><button class="ok" data-act="set-done" data-x="${x}" data-i="${i}" aria-label="${lbl} done" aria-pressed="${!!s.done}">${icon('tick', 18, 2.8)}</button></td></tr>`;
    });
    H += `</tbody></table><button class="addset" data-act="set-add" data-x="${x}">${icon('plus', 15)} Add Set</button></section>`;
  });
  H += `<button class="btn btn-tint block" style="--accent:${BLUE};margin-top:6px" data-act="picker">Add Exercises</button>`;
  if (W.ex.length && !W.template) H += `<button class="btn btn-glass block" style="margin-top:10px" data-act="routine-from-workout">Save as template</button>`;
  H += `<button class="btn btn-danger block" style="margin-top:12px" data-act="workout-cancel">${W.edit ? 'Discard changes' : W.template ? 'Discard template' : 'Cancel Workout'}</button>`;
  return H;
}

export function openWorkout() {
  if (!state.workout) return;
  if (document.querySelector('[data-sheet="workout"]:not(.closing)')) return;
  const W = state.workout;
  openSheet({
    id: 'workout', full: true, title: W.template ? 'New template' : W.edit ? 'Edit workout' : '',
    left: `<button class="circle sm btn-glass" data-act="sheet-close" aria-label="Minimise">${icon('down', 18)}</button>`
      + (W.edit || W.template ? '' : `<span class="wo-timer num" data-elapsed></span>`),
    right: `<button class="btn sm btn-prominent" style="--accent:${GREEN}" data-act="workout-finish">${W.template ? 'Save' : W.edit ? 'Save' : 'Finish'}</button>`,
    render: () => renderWorkout(),
    onClose: () => changed(),
  });
  const pill = document.getElementById('wo-pill'); if (pill) pill.remove();
}

/** Open a past session in the logger. Saving sends one workout.set that replaces it on the PC. */
function editSession(w) {
  if (state.workout) { toast(state.workout.edit ? 'Finish the edit you started first' : 'Finish or cancel the current workout first'); openWorkout(); return; }
  const key = w.id || w.ts; if (!key) { toast('This session has no id to edit by'); return; }
  state.workout = {
    id: 'e' + uid(), start: Date.now(), restEnd: 0, name: w.name || '', notes: w.notes || '',
    edit: { key, id: w.id || null, date: w.date, ts: w.ts, duration: w.duration || 0, notes: w.notes || '', type: w.type },
    ex: (w.exercises || []).map(e => ({
      n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other', note: e.note || '', ss: e.ss || undefined,
      sets: [...(e.warm || []).map(s => ({ w: String(s.w), r: String(s.r), done: true, warm: true })),
        ...(e.sets || []).map(s => ({ w: String(s.w), r: String(s.r), done: true, rpe: s.rpe, type: s.type }))],
    })),
  };
  changed({ now: true });
  closeSheet(topSheet());
  openWorkout();
}

/* ── rest timer: in the workout sheet (pinned under its header) and in the pill ── */
let restTm = null;
export function restTick() {
  const W = state.workout;
  const left = W && W.restEnd ? Math.ceil((W.restEnd - Date.now()) / 1000) : 0;
  const bar = document.querySelector('[data-restbar]');
  if (left > 0) {
    if (bar && bar.hidden) { const s = topSheet(); if (s && s.id === 'workout') s.refresh(); }
    document.querySelectorAll('[data-rest]').forEach(el => { el.textContent = fmtMinS(left); });
    const p = document.querySelector('[data-rest-p]'); if (p && W.restTotal) p.style.width = Math.max(0, Math.min(100, (1 - left / W.restTotal) * 100)) + '%';
    if (!restTm) restTm = setInterval(restTick, 250);
  } else {
    if (W && W.restEnd) { W.restEnd = 0; changed({ silent: true }); chime(); haptic(); toast('Rest over — ' + nextSetHint().replace('Next: ', '')); }
    if (bar && !bar.hidden) { bar.hidden = true; bar.innerHTML = ''; }
    document.querySelectorAll('[data-rest]').forEach(el => { el.textContent = ''; });
    clearInterval(restTm); restTm = null;
  }
}

/* ── finish ── */
function buildSession(W) {
  const exOut = [], muscles = {}, labels = {}, setsMap = {}, cats = {};
  let vol = 0, total = 0;
  W.ex.forEach(e => {
    const ok = s => s.done && s.w !== '' && s.r !== '';
    const done = e.sets.filter(s => ok(s) && !s.warm).map(s => {
      const o = { w: +s.w || 0, r: +s.r || 0 };
      if (s.rpe != null && s.rpe !== '') o.rpe = +s.rpe;
      if (s.type) o.type = s.type;
      return o;
    });
    if (!done.length) return;
    const warm = e.sets.filter(s => ok(s) && s.warm).map(s => ({ w: +s.w || 0, r: +s.r || 0 }));
    const o = { n: e.n, c: e.c, g: e.g, m: e.m, e: e.e, sets: done };
    if (warm.length) o.warm = warm;
    if (e.note) o.note = e.note;
    if (e.ss) o.ss = e.ss;
    exOut.push(o);
    (e.m || []).forEach(m => { muscles[m] = true; });
    labels[e.g] = true; setsMap[e.g] = (setsMap[e.g] || 0) + done.length;
    cats[e.c] = (cats[e.c] || 0) + done.length;
    done.forEach(s => { vol += s.w * s.r; total++; });
  });
  const cnt = {}; exOut.forEach(e => { if (e.ss) cnt[e.ss] = (cnt[e.ss] || 0) + 1; });
  exOut.forEach(e => { if (e.ss && cnt[e.ss] < 2) delete e.ss; });
  const ck = Object.keys(cats);
  return { exOut, total, fields: { type: ck.length === 1 ? ck[0] : 'full', muscles: Object.keys(muscles), labels: Object.keys(labels),
    sets: setsMap, exercises: exOut, volume: Math.round(vol), unit: unit() } };
}
/** Apple Health through a Shortcut named "ARK Workout" (web apps cannot write to HealthKit themselves). */
function healthUrl(s) {
  const end = new Date(Date.parse(s.ts)), start = new Date(end.getTime() - (s.duration || 0) * 1000);
  const payload = { name: s.name || 'Strength training', start: start.toISOString(), end: end.toISOString(), minutes: Math.round((s.duration || 0) / 60), sets: s.exercises.reduce((a, e) => a + e.sets.length, 0) };
  return 'shortcuts://run-shortcut?name=' + encodeURIComponent('ARK Workout') + '&input=text&text=' + encodeURIComponent(JSON.stringify(payload));
}
function finish() {
  const W = state.workout, v = view();
  if (W.template) { routineSheet(W.ex, W.name && W.name !== defaultName() ? W.name : '', true); return; }
  const { exOut, total, fields } = buildSession(W);
  if (!exOut.length) { toast(W.edit ? 'Keep at least one ticked working set — or delete the session instead' : 'Tick at least one set first'); return; }
  const others = W.edit ? v.workouts.filter(w => (w.id || w.ts) !== W.edit.key && w.date <= W.edit.date) : v.workouts;
  const prev = prs(others), hits = [];
  exOut.forEach(e => {
    let bw = 0, bo = 0; e.sets.forEach(s => { bw = Math.max(bw, s.w); bo = Math.max(bo, L.e1rm(s.w, s.r)); });
    const p = prev[e.n];
    if (p && bw > p.w + 0.01) hits.push(e.n + ' — ' + fmt1(bw) + ' ' + unit());
    else if (p && bo > p.orm + 0.01) hits.push(e.n + ' — est. 1RM ' + Math.round(bo));
  });
  const name = (W.name || '').trim();
  if (W.edit) {
    const E = W.edit;
    const session = { ...fields, date: E.date, ts: E.ts, duration: E.duration, notes: (W.notes || '').trim(), prCount: hits.length };
    if (name) session.name = name;
    if (E.id) session.id = E.id;
    state.workout = null; closeSheet(topSheet());
    emit('workout.set', { key: E.key, session });
    haptic(); toast('Changes saved · ' + fmtDay(E.date, { day: 'numeric', month: 'short' }));
    return;
  }
  const session = {
    id: W.id, date: today(), ts: new Date().toISOString(), ...fields, name: name || defaultName(),
    duration: Math.floor((Date.now() - W.start) / 1000), prCount: hits.length, notes: (W.notes || '').trim(), src: 'phone',
  };
  state.workout = null;
  closeSheet(topSheet());
  emit('workout.add', { session });
  haptic();
  const nth = v.workouts.length + 1;
  openSheet({
    id: 'summary', title: '',
    render: () => `<div style="text-align:center;margin:0 0 18px"><div style="font-size:3.2rem;line-height:1">${hits.length ? '🏆' : '💪'}</div>
        <h2 style="margin:8px 0 2px;font-size:1.5rem">Congratulations!</h2>
        <div class="sub">That's your ${nth}${[, 'st', 'nd', 'rd'][nth % 100 > 10 && nth % 100 < 14 ? 0 : nth % 10] || 'th'} workout · ${esc(session.name)}</div></div>
      <div class="stat3"><div class="frost"><div class="v num">${fmtDur(session.duration)}</div><div class="k">Duration</div></div>
        <div class="frost"><div class="v num">${session.volume.toLocaleString()}</div><div class="k">Volume · ${unit()}</div></div>
        <div class="frost"><div class="v num">${total}</div><div class="k">Sets</div></div></div>
      ${hits.length ? `<div class="sec"><h2>New records</h2></div><section class="list frost">${hits.map(h => `<div class="li" style="--c:#ffd60a"><span class="ic">${icon('trophy', 18)}</span><span class="tx"><div class="tt">${esc(h)}</div></span></div>`).join('')}</section>` : ''}
      <a class="btn btn-glass block" style="margin-top:18px;text-decoration:none" href="${esc(healthUrl(session))}">${icon('heart', 17)} Save to Apple Health</a>
      <p class="sub" style="text-align:center;margin:8px 0 16px;line-height:1.45">Runs your "ARK Workout" shortcut — set it up once in Settings › Siri &amp; Apple Watch.</p>
      <button class="btn btn-prominent block" style="--accent:${BLUE}" data-act="sheet-close">Done</button>`,
  });
}

/* ── exercise picker (multi-select, like Strong's Add Exercises) ── */
let pk = { q: '', g: 'all', e: 'all', sel: [], replace: null };
function pickerList() {
  const q = pk.q.trim().toLowerCase();
  const inWorkout = new Set((state.workout ? state.workout.ex : []).map(e => e.n));
  const lib = library().filter(e => (pk.g === 'all' || (e.g || '').toLowerCase() === pk.g)
    && (pk.e === 'all' || (pk.e === 'other' ? !['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight'].includes(e.e) : e.e === pk.e))
    && (!q || e.n.toLowerCase().includes(q) || (e.alias || []).some(a => a.toLowerCase().includes(q))));
  let H = '', letter = '';
  lib.forEach(e => {
    const L1 = e.n.charAt(0).toUpperCase();
    if (L1 !== letter) { H += (letter ? '</section>' : '') + `<div class="pk-grp">${esc(L1)}</div><section class="list frost">`; letter = L1; }
    const last = lastSetsFor(e.n), on = pk.sel.includes(e.n), has = inWorkout.has(e.n);
    H += `<button class="li pk-i${on ? ' on' : ''}" data-act="pick-ex" data-n="${esc(e.n)}" ${has && !pk.replace ? 'disabled' : ''} aria-pressed="${on}">
      <span class="tx"><div class="tt">${esc(e.n)}</div><div class="st">${esc((e.m || []).slice(0, 2).map(MNAME).join(', '))}${last ? ' · last ' + last.slice(0, 2).map(s => fmt1(s.w) + '×' + s.r).join(', ') : ''}</div></span>
      <span class="pk-c">${has && !pk.replace ? icon('tick', 16) : on ? icon('tick', 16, 2.6) : ''}</span></button>`;
  });
  if (letter) H += '</section>';
  if (q && !library().some(e => e.n.toLowerCase() === q)) {
    H += `<div class="pk-grp">New exercise</div><section class="card frost tight"><div class="sub" style="margin-bottom:10px">Add “${esc(pk.q.trim())}” — which muscle group does it train?</div>
      <div class="chips">${Object.keys(GROUPS).map(g => `<button class="chip" data-act="pick-custom" data-g="${g}">${GROUPS[g][0]}</button>`).join('')}</div></section>`;
  }
  return H || '<div class="empty">Nothing matches.</div>';
}
function pickerRight() {
  return pk.replace !== null ? `<span style="width:44px"></span>`
    : `<button class="btn sm btn-prominent" style="--accent:${BLUE}" data-act="pick-add" ${pk.sel.length ? '' : 'disabled'}>Add${pk.sel.length ? ' (' + pk.sel.length + ')' : ''}</button>`;
}
export function openPicker(group, replace = null) {
  pk = { q: '', g: group || 'all', e: 'all', sel: [], replace };
  const s = openSheet({
    id: 'picker', title: replace !== null ? 'Replace exercise' : 'Add exercises', full: true,
    left: `<button class="circle sm btn-glass" data-act="sheet-close" aria-label="Close">${icon('x', 16)}</button>`,
    right: pickerRight(),
    render: () => `<input class="inp" type="search" placeholder="Search ${library().length} exercises" data-pk-search value="${esc(pk.q)}" autocomplete="off" style="margin-bottom:10px">
      <div class="chips scroll1" style="margin-bottom:8px"><button class="chip ${pk.g === 'all' ? 'on' : ''}" data-act="pk-group" data-g="all">Any body part</button>${Object.keys(GROUPS).map(g =>
        `<button class="chip ${pk.g === g ? 'on' : ''}" data-act="pk-group" data-g="${g}">${GROUPS[g][0]}</button>`).join('')}</div>
      <div class="chips scroll1" style="margin-bottom:6px">${EQUIP.map(([k, l]) => `<button class="chip ${pk.e === k ? 'on' : ''}" data-act="pk-equip" data-e="${k}">${k === 'all' ? 'Any equipment' : l}</button>`).join('')}</div>
      <div data-pk-list>${pickerList()}</div>`,
  });
  return s;
}
export function pickerSearch(q) {
  pk.q = q;
  const el = document.querySelector('[data-pk-list]');
  if (el) el.innerHTML = pickerList();
}

/* ── exercise library & detail ── */
function libSheet() {
  pk = { q: '', g: 'all', e: 'all', sel: [], replace: 'lib' };
  openSheet({
    id: 'picker', title: 'Exercises', full: true,
    left: `<button class="circle sm btn-glass" data-act="sheet-close" aria-label="Close">${icon('x', 16)}</button>`,
    render: () => `<input class="inp" type="search" placeholder="Search ${library().length} exercises" data-pk-search value="${esc(pk.q)}" autocomplete="off" style="margin-bottom:10px">
      <div class="chips scroll1" style="margin-bottom:8px"><button class="chip ${pk.g === 'all' ? 'on' : ''}" data-act="pk-group" data-g="all">Any body part</button>${Object.keys(GROUPS).map(g =>
        `<button class="chip ${pk.g === g ? 'on' : ''}" data-act="pk-group" data-g="${g}">${GROUPS[g][0]}</button>`).join('')}</div>
      <div class="chips scroll1" style="margin-bottom:6px">${EQUIP.map(([k, l]) => `<button class="chip ${pk.e === k ? 'on' : ''}" data-act="pk-equip" data-e="${k}">${k === 'all' ? 'Any equipment' : l}</button>`).join('')}</div>
      <div data-pk-list>${pickerList()}</div>`,
  });
}
function exHistSheet(name) {
  let seg = 'about';
  const s = openSheet({
    id: 'ex-hist', title: name,
    render: () => {
      const v = view(), lib = L.findExercise(name), lo = L.loadingOf({ n: name, m: (lib || {}).m });
      const pts = L.exerciseHistory(v.workouts.map(w => ({ ...w, exercises: (w.exercises || []).map(e => L.sameExercise(e.n, name) ? { ...e, n: name } : e) })), name);
      let H = `<div class="seg" style="margin-bottom:14px">${[['about', 'About'], ['history', 'History'], ['charts', 'Charts']].map(([k, l]) =>
        `<button class="${seg === k ? 'on' : ''}" data-act="exh-seg" data-seg="${k}">${l}</button>`).join('')}</div>`;
      if (seg === 'about') {
        const mus = Object.entries(lo.load).sort((a, b) => b[1] - a[1]);
        const tis = Object.entries(lo.tis).sort((a, b) => b[1] - a[1]);
        H += `<div class="sub" style="margin-bottom:10px">${lib ? esc(EQUIP_LBL[lib.e] || lib.e) + ' · ' + lib.mech + (() => { const aka = [lib.n, ...(lib.alias || [])].filter(a => a !== name).slice(0, 2); return aka.length ? ' · also called ' + esc(aka.join(', ')) : ''; })() : 'Your own exercise'}</div>
          <div class="eyebrow" style="margin-bottom:6px">Muscles worked</div>
          <section class="card frost tight">${mus.map(([m, x]) => `<div class="ld-r"><span>${esc(MNAME(m))}</span><span class="ld-t"><b style="width:${x * 100}%;background:${BLUE}"></b></span><span class="sub">${x >= 0.8 ? 'prime' : x >= 0.4 ? 'major' : 'helper'}</span></div>`).join('')}</section>
          ${tis.length ? `<div class="eyebrow" style="margin:14px 0 6px">Tendons & joints loaded</div>
          <section class="card frost tight">${tis.map(([k, x]) => `<div class="ld-r"><span>${esc((L.TENDONS[k] || {}).name || k)}</span><span class="ld-t"><b style="width:${x * 100}%;background:#ffb340"></b></span><span class="sub">${x >= 0.7 ? 'high' : x >= 0.4 ? 'moderate' : 'low'}</span></div>`).join('')}</section>` : ''}
          <p class="sub" style="line-height:1.5;margin-top:12px">Relative loading from biomechanics and EMG consensus. It drives the tendon and androgen-receptor estimates in Body Arch.</p>`;
      } else if (!pts.length) {
        H += `<div class="empty">No sets of ${esc(name)} logged yet.</div>`;
      } else if (seg === 'history') {
        const rows = v.workouts.filter(w => (w.exercises || []).some(e => L.sameExercise(e.n, name))).slice(-20).reverse();
        H += `<div class="stack">${rows.map(w => { const e = w.exercises.find(x => L.sameExercise(x.n, name));
          return `<section class="card frost tight"><div class="row"><b style="flex:1">${esc(w.name || fmtDay(w.date, { weekday: 'long' }))}</b><span class="sub">${fmtDay(w.date, { day: 'numeric', month: 'short', year: '2-digit' })}</span></div>
            ${e.sets.map((st, i) => `<div class="hx"><span>${i + 1}</span><span class="num">${fmt1(st.w)} ${unit()} × ${st.r}${st.rpe ? ' @' + st.rpe : ''}</span><span class="num sub">${Math.round(L.e1rm(+st.w || 0, +st.r || 0))}</span></div>`).join('')}</section>`; }).join('')}</div>`;
      } else {
        const best = pts.reduce((a, p) => (p.e1rm > a.e1rm ? p : a), pts[0]);
        const top = pts.reduce((a, p) => Math.max(a, p.top), 0);
        const chart = (key, col) => pts.length > 1 ? sparkSvg(pts.map(p => ({ t: Date.parse(p.date), y: p[key] })), col, 80) : '<div class="sub" style="padding:8px 0">The line starts after a second session.</div>';
        H += `<div class="stat3" style="margin-bottom:12px"><div class="frost"><div class="v num">${Math.round(best.e1rm)}</div><div class="k">Best est. 1RM</div></div>
            <div class="frost"><div class="v num">${fmt1(top)}</div><div class="k">Heaviest · ${unit()}</div></div>
            <div class="frost"><div class="v num">${pts.length}</div><div class="k">Sessions</div></div></div>
          <section class="card frost"><div class="card-h"><span class="t">Estimated 1RM</span></div>${chart('e1rm', BLUE)}</section>
          <section class="card frost" style="margin-top:10px"><div class="card-h"><span class="t">Best set weight</span></div>${chart('top', GREEN)}</section>
          <section class="card frost" style="margin-top:10px"><div class="card-h"><span class="t">Volume</span><span class="k">${unit()}</span></div>${chart('volume', '#ffb340')}</section>`;
      }
      return H;
    },
  });
  s.seg = v => { seg = v; s.refresh(); };
}

function sessionSheet(i) {
  const w0 = view().workouts[i]; if (!w0) return;
  const key = w0.id || w0.ts;
  openSheet({
    id: 'session', title: w0.name || fmtDay(w0.date, { weekday: 'long', day: 'numeric', month: 'short' }),
    render: () => {
      const w = view().workouts.find(x => (x.id || x.ts) === key);
      if (!w) return `<div class="empty">This session has been deleted.</div>`;
      return `<div class="sub" style="text-align:center;margin:-6px 0 12px">${fmtDay(w.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
      <div class="stat3" style="margin-bottom:14px"><div class="frost"><div class="v num">${w.duration ? fmtDur(w.duration) : '—'}</div><div class="k">Duration</div></div>
      <div class="frost"><div class="v num">${Math.round(w.volume).toLocaleString()}</div><div class="k">Volume · ${w.unit || unit()}</div></div>
      <div class="frost"><div class="v num">${w.exercises.reduce((a, e) => a + e.sets.length, 0)}</div><div class="k">Sets</div></div></div>
      <div class="stack">${w.exercises.map(e => `<section class="card frost tight${e.ss ? ' ss' : ''}"${e.ss ? ` style="--ssc:${ssColor(e.ss)}"` : ''}>
        <div class="row"><button class="ex-name blue" style="flex:1" data-act="ex-hist" data-n="${esc(e.n)}"><b>${esc(e.n)}</b></button>
          ${e.ss ? `<span class="tag" style="--c:${ssColor(e.ss)}">Superset ${esc(e.ss)}</span>` : ''}</div>
        ${(e.warm || []).map(s => `<div class="hx"><span style="color:var(--orange)">W</span><span class="num">${fmt1(s.w)} × ${s.r}</span><span></span></div>`).join('')}
        ${e.sets.map((s, j) => `<div class="hx"><span>${s.type === 'd' ? 'D' : s.type === 'f' ? 'F' : j + 1}</span><span class="num">${fmt1(s.w)} ${w.unit || unit()} × ${s.r}${s.rpe ? ' @' + s.rpe : ''}</span><span class="num sub">${Math.round(L.e1rm(+s.w || 0, +s.r || 0))}</span></div>`).join('')}
        ${e.note ? `<div class="sub" style="margin-top:6px;display:flex;gap:6px;align-items:center">${icon('note', 13)}<span>${esc(e.note)}</span></div>` : ''}</section>`).join('')}</div>
      ${w.notes ? `<p class="sub" style="margin-top:14px">${esc(w.notes)}</p>` : ''}
      ${key ? `<div class="row" style="gap:10px;margin-top:18px">
        <button class="btn btn-glass" style="flex:1" data-act="session-edit" data-key="${esc(key)}">${icon('pencil', 16)} Edit</button>
        <button class="btn btn-glass" style="flex:1" data-act="routine-from-session" data-key="${esc(key)}">Save as template</button></div>
        <a class="btn btn-glass block" style="margin-top:10px;text-decoration:none" href="${esc(healthUrl({ ...w, ts: w.ts || new Date().toISOString() }))}">${icon('heart', 16)} Save to Apple Health</a>
        <button class="btn btn-danger block" style="margin-top:10px" data-act="session-del" data-key="${esc(key)}">${icon('trash', 16)} Delete session</button>` : ''}`;
    },
  });
}

/* ── template preview ── */
function templateSheet(i) {
  const r = (view().routines || [])[i]; if (!r) return;
  openSheet({
    id: 'tpl', title: r.name,
    render: () => `<section class="list frost" style="margin-bottom:14px">${r.ex.map(e => { const last = lastSetsFor(e.n);
        return `<div class="li"><span class="tx"><div class="tt">${(e.sets || []).length || 3} × ${esc(e.n)}</div>
          <div class="st">${esc((e.m || []).slice(0, 2).map(MNAME).join(', '))}${last ? ' · last ' + last.slice(0, 3).map(s => fmt1(s.w) + '×' + s.r).join(', ') : ''}</div></span></div>`; }).join('')}</section>
      <button class="btn btn-prominent block" style="--accent:${BLUE}" data-act="start-routine" data-i="${i}">Start Workout</button>
      <button class="btn btn-danger block" style="margin-top:10px" data-act="tpl-del" data-i="${i}">Delete template</button>`,
  });
}

/* ── exercise menu ── */
function exMenu(x) {
  const W = state.workout, ex = W && W.ex[x]; if (!ex) return;
  const next = W.ex[x + 1], linked = ex.ss && next && next.ss === ex.ss;
  openSheet({
    id: 'ex-menu', title: ex.n,
    render: () => `<section class="list frost">
      <button class="li" data-act="ex-hist" data-n="${esc(ex.n)}"><span class="ic" style="--c:${BLUE}">${icon('chart', 17)}</span><span class="tx"><div class="tt">History & charts</div></span><span class="chev">${icon('chev', 15)}</span></button>
      <button class="li" data-act="ex-note" data-x="${x}"><span class="ic" style="--c:#ffb340">${icon('note', 17)}</span><span class="tx"><div class="tt">Note & rest timer</div><div class="st">Rest ${Math.round(restFor(ex))} s</div></span><span class="chev">${icon('chev', 15)}</span></button>
      <button class="li" data-act="warm-add" data-x="${x}"><span class="ic" style="--c:var(--orange)">${icon('plus', 17)}</span><span class="tx"><div class="tt">Add warm-up set</div></span></button>
      ${ex.e === 'barbell' ? `<button class="li" data-act="plates" data-x="${x}"><span class="ic" style="--c:#40c8e0">${icon('plates', 17)}</span><span class="tx"><div class="tt">Plate calculator</div></span><span class="chev">${icon('chev', 15)}</span></button>` : ''}
      ${next ? `<button class="li" data-act="ss-link" data-x="${x}"><span class="ic" style="--c:#bf5af2">${icon('link', 17)}</span><span class="tx"><div class="tt">${linked ? 'Remove superset with' : 'Superset with'} ${esc(next.n)}</div></span></button>` : ''}
      <button class="li" data-act="ex-replace" data-x="${x}"><span class="ic" style="--c:#30d158">${icon('sync', 17)}</span><span class="tx"><div class="tt">Replace exercise</div></span><span class="chev">${icon('chev', 15)}</span></button>
      <button class="li" data-act="ex-remove" data-x="${x}"><span class="ic" style="--c:#ff453a">${icon('trash', 17)}</span><span class="tx"><div class="tt" style="color:#ff453a">Remove exercise</div></span></button>
    </section>`,
  });
}

/* ── set options: type, RPE, remove ── */
const RPES = [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
function setMenu(x, i) {
  openSheet({
    id: 'set-menu', title: 'Set options',
    render: () => {
      const W = state.workout, ex = W && W.ex[x], s = ex && ex.sets[i];
      if (!s) return '<div class="empty">That set is gone.</div>';
      const kind = s.warm ? 'w' : s.type || 'n';
      return `<div class="sub" style="text-align:center;margin:-4px 0 14px">${esc(ex.n)}</div>
        <div class="seg" style="margin-bottom:10px">${[['n', 'Normal'], ['w', 'Warm-up'], ['d', 'Drop set'], ['f', 'Failure']].map(([k, l]) =>
          `<button class="${kind === k ? 'on' : ''}" data-act="set-type" data-x="${x}" data-i="${i}" data-v="${k}">${l}</button>`).join('')}</div>
        <p class="sub" style="line-height:1.5;margin:0 0 16px">${kind === 'w' ? 'Warm-ups are kept with the session but never count toward volume, records or targets.'
          : kind === 'd' ? 'A drop set: straight after the previous set, lighter. Counts as a working set.' : kind === 'f' ? 'Taken to failure. Counts as a working set; RPE 10.' : 'A normal working set.'}</p>
        ${kind === 'w' ? '' : `<div class="eyebrow" style="margin-bottom:8px">RPE · how hard it was</div>
        <div class="chips" style="margin-bottom:8px"><button class="chip ${s.rpe == null ? 'on' : ''}" data-act="set-rpe" data-x="${x}" data-i="${i}" data-v="">–</button>${RPES.map(r =>
          `<button class="chip num ${+s.rpe === r ? 'on' : ''}" data-act="set-rpe" data-x="${x}" data-i="${i}" data-v="${r}">${r}</button>`).join('')}</div>
        <p class="sub" style="line-height:1.5;margin:0 0 16px">10 = nothing left · 9 = one more rep was possible · 8 = two in reserve. It feeds the hormone model's training intensity and the deload advice.</p>`}
        <button class="btn btn-danger block" data-act="set-del" data-x="${x}" data-i="${i}" ${ex.sets.length < 2 ? 'disabled' : ''}>${icon('trash', 16)} Remove this set</button>`;
    },
  });
}

/* ── exercise note & rest ── */
function exNoteSheet(x) {
  const ex = state.workout && state.workout.ex[x]; if (!ex) return;
  openSheet({
    id: 'ex-note', title: 'Note · ' + ex.n,
    render: () => {
      const own = (state.settings.restByEx || {})[ex.n] || 0, auto = L.restSeconds(ex, state.settings.rest || 90);
      const fmtS = sec => sec < 120 ? sec + ' s' : (sec / 60) + ' min';
      return `<textarea class="inp" data-exnote maxlength="200" placeholder="Seat height, grip, how it felt…">${esc(ex.note || '')}</textarea>
      <button class="btn btn-prominent block" style="margin-top:14px;--accent:${BLUE}" data-act="ex-note-save" data-x="${x}">Save note</button>
      <p class="sub" style="text-align:center;margin:12px 0 18px">Shown next time you do ${esc(ex.n)}.</p>
      <div class="eyebrow" style="margin-bottom:8px">Rest after each set</div>
      <div class="chips"><button class="chip ${own ? '' : 'on'}" data-act="ex-rest" data-x="${x}" data-v="0">Auto · ${fmtS(auto)}</button>${[60, 90, 120, 180, 240].map(v =>
        `<button class="chip ${own === v ? 'on' : ''}" data-act="ex-rest" data-x="${x}" data-v="${v}">${fmtS(v)}</button>`).join('')}</div>
      <p class="sub" style="margin-top:10px;line-height:1.5">Auto gives heavy compound lifts at least 2½ minutes and isolation work at most 75 s. Remembered for this exercise.</p>`;
    },
  });
}

/* ── plate calculator ── */
const PLATE_SETS = { kg: [25, 20, 15, 10, 5, 2.5, 1.25], lb: [45, 35, 25, 10, 5, 2.5] };
const BARS = { kg: [20, 15, 10], lb: [45, 35, 25] };
const PLATE_COL = { 25: '#ff453a', 20: '#0a84ff', 15: '#ffd60a', 10: '#30d158', 5: '#f5f7fa', 2.5: '#8e8e93', 1.25: '#c7c7cc', 45: '#0a84ff', 35: '#ffd60a' };
let plTarget = 0;
function platesSheet(x) {
  const W = state.workout, ex = W && W.ex[x], u = unit() === 'lb' ? 'lb' : 'kg';
  const typed = ex && ex.sets.map(s => parseFloat(s.w)).filter(n => n > 0).pop();
  const ph = ex ? placeholder(ex, ex.sets.findIndex(s => !s.w && !s.warm)) : null;
  plTarget = typed || (ph && parseFloat(ph.w)) || (u === 'kg' ? 60 : 135);
  if (!BARS[u].includes(state.settings.bar)) state.settings.bar = BARS[u][0];
  openSheet({
    id: 'plates', title: 'Plates' + (ex ? ' · ' + ex.n : ''),
    render: () => {
      const bar = state.settings.bar, r = L.platesFor(plTarget, bar, PLATE_SETS[u]);
      const h = p => 34 + Math.round(p / PLATE_SETS[u][0] * 58);
      const side = r.perSide.map(p => `<i style="height:${h(p)}px;background:${PLATE_COL[p] || '#aaa'}" title="${p}"></i>`).join('');
      return `<div class="pl-in"><button class="circle btn-glass" data-act="pl-step" data-d="-${u === 'kg' ? 2.5 : 5}" aria-label="Less">${icon('minus', 18)}</button>
          <input class="inp num" type="number" inputmode="decimal" step="0.5" value="${fmt1(plTarget)}" data-pl-input aria-label="Target weight">
          <button class="circle btn-glass" data-act="pl-step" data-d="${u === 'kg' ? 2.5 : 5}" aria-label="More">${icon('plus', 18)}</button></div>
        <div class="pl-bar" aria-hidden="true"><div class="pl-side l">${side}</div><span class="pl-rod"></span><div class="pl-side">${side}</div></div>
        <div style="text-align:center;margin:6px 0 14px"><div class="num" style="font-size:1.4rem;font-weight:700">${r.perSide.length ? r.perSide.map(p => String(p)).join(' + ') : 'Empty bar'}</div>
          <div class="sub">${r.perSide.length ? 'on each side · ' : ''}${fmt1(r.loaded)} ${u} loaded</div>
          ${r.remainder > 0 ? `<div class="sub" style="color:var(--orange);margin-top:6px">${fmt1(plTarget)} ${u} can't be loaded exactly — ${fmt1(r.loaded)} is the nearest below.</div>` : ''}</div>
        <div class="eyebrow" style="margin-bottom:8px">Bar</div>
        <div class="seg">${BARS[u].map(b => `<button class="${bar === b ? 'on' : ''}" data-act="pl-bar" data-v="${b}">${b} ${u}</button>`).join('')}</div>`;
    },
  });
}
export function onPlatesInput(el) {
  const n = parseFloat(String(el.value).replace(',', '.'));
  if (!(n > 0 && n < 1000)) return;
  plTarget = n;
  const s = topSheet(); if (s && s.id === 'plates') { const pos = el.selectionStart; s.refresh(); const i = document.querySelector('[data-pl-input]'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }
}

/* ── save as template ── */
let rtEx = null, rtFromTemplateMode = false;
function routineSheet(exList, suggested, templateMode = false) {
  rtFromTemplateMode = templateMode;
  rtEx = exList.map(e => ({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other',
    sets: e.sets.filter(s => !s.warm).map(s => ({ w: s.w === '' ? '' : +s.w || 0, r: s.r === '' ? '' : +s.r || 0 })) }))
    .filter(e => e.sets.length);
  if (!rtEx.length) { toast('Add an exercise with at least one set first'); return; }
  openSheet({
    id: 'routine', title: 'Save template',
    render: () => `<label class="field"><span>Name</span><input class="inp" data-rt-name maxlength="60" value="${esc(suggested || '')}" placeholder="e.g. Push A"></label>
      <section class="list frost" style="margin-bottom:14px">${rtEx.map(e => `<div class="li"><span class="tx"><div class="tt">${e.sets.length} × ${esc(e.n)}</div>
        <div class="st">${e.sets[0].w !== '' ? e.sets.map(s => fmt1(s.w) + '×' + s.r).join(', ') : 'targets fill in from your history'}</div></span></div>`).join('')}</section>
      <button class="btn btn-prominent block" style="--accent:${BLUE}" data-act="routine-save">Save template</button>
      <p class="sub" style="text-align:center;margin-top:12px">It appears under Templates, here and in ARK on your PC.</p>`,
  });
}

/* ══════════════ actions ══════════════ */
export const actions = {
  'start-empty'() { startWith([]); if (state.workout && !state.workout.ex.length) openPicker(); },
  'tpl-new'() { startWith([], { template: true, name: '' }); if (state.workout && !state.workout.ex.length) openPicker(); },
  'tpl-open'(d) { templateSheet(Number(d.i)); },
  'tpl-del'(d) {
    const r = (view().routines || [])[Number(d.i)]; if (!r) return;
    if (!confirm('Delete the template “' + r.name + '”? Your logged workouts are not affected.')) return;
    closeSheet(topSheet()); emitUndoable('routine.del', { name: r.name }, 'Template deleted');
  },
  'start-routine'(d) {
    const r = (view().routines || [])[Number(d.i)]; if (!r) return;
    if (topSheet() && topSheet().id === 'tpl') closeSheet(topSheet());
    startWith(r.ex.map(e => newExercise({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' }, (e.sets || []).length)), { name: r.name });
  },
  'start-repeat'() {
    const ws = view().workouts, last = ws[ws.length - 1]; if (!last) return;
    startWith(last.exercises.map(e => newExercise({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' }, e.sets.length)), { name: last.name || defaultName() });
  },
  'start-suggested'() {
    const P = planNow();
    if (!P.rest) { startPlan(P); return; }
    const v = view(), want = trainNext(v).map(m => m.group);
    let best = null, score = 0;
    (v.routines || []).forEach(r => {
      const gs = new Set(r.ex.map(e => (e.g || '').toLowerCase()));
      const s = want.reduce((a, g, i) => a + (gs.has(g) ? 3 - i : 0), 0);
      if (s > score) { score = s; best = r; }
    });
    if (best) actions['start-routine']({ i: v.routines.indexOf(best) });
    else { startWith([]); if (state.workout && !state.workout.ex.length) openPicker(want[0]); }
  },
  'open-workout'() { openWorkout(); },
  'load-sheet'() { loadSheet(); },
  'lib-open'() { libSheet(); },
  picker() { openPicker(); },
  'pk-group'(d) { pk.g = d.g; const s = topSheet(); s && s.refresh(); },
  'pk-equip'(d) { pk.e = d.e; const s = topSheet(); s && s.refresh(); },
  'pick-ex'(d) {
    if (pk.replace === 'lib') { exHistSheet(d.n); return; }
    if (pk.replace !== null) {
      const W = state.workout, x = pk.replace, old = W && W.ex[x], meta = exFromLib(d.n); if (!old || !meta) return;
      W.ex[x] = { ...newExercise(meta, old.sets.filter(isWork).length || 3), ss: old.ss };
      closeSheet(topSheet()); haptic(); changed();
      toast(old.n + ' → ' + meta.n, 'Undo', () => { W.ex[x] = old; changed(); });
      return;
    }
    const i = pk.sel.indexOf(d.n);
    if (i >= 0) pk.sel.splice(i, 1); else pk.sel.push(d.n);
    haptic();
    const s = topSheet(); if (s) { s.right = pickerRight(); const body = s.el.querySelector('.sheet-body'); const top = body ? body.scrollTop : 0; s.refresh(); const nb = s.el.querySelector('.sheet-body'); if (nb) nb.scrollTop = top; }
  },
  'pick-add'() {
    if (!state.workout || !pk.sel.length) return;
    pk.sel.forEach(n => { const meta = exFromLib(n); if (meta) state.workout.ex.push(newExercise(meta)); });
    pk.sel = []; closeSheet(topSheet()); changed();
  },
  'pick-custom'(d) {
    const gk = grpKeys()[d.g] || GRP_KEY_FALLBACK[d.g], name = pk.q.trim(); if (!name || !state.workout) return;
    state.workout.ex.push(newExercise({ n: name, c: gk.c, g: gk.g, m: gk.m, e: 'other' }, 3));
    closeSheet(topSheet()); changed();
  },
  'ex-menu'(d) { exMenu(Number(d.x)); },
  'ex-replace'(d) { closeSheet(topSheet()); openPicker(null, Number(d.x)); },
  'ex-remove'(d) {
    if (topSheet() && topSheet().id === 'ex-menu') closeSheet(topSheet());
    const x = Number(d.x), W = state.workout, gone = W.ex[x];
    W.ex.splice(x, 1); changed();
    toast(gone.n + ' removed', 'Undo', () => { W.ex.splice(x, 0, gone); changed(); });
  },
  'set-add'(d) {
    const ex = state.workout.ex[Number(d.x)], work = ex.sets.filter(isWork), l = work[work.length - 1];
    ex.sets.push({ w: l ? l.w : '', r: l ? l.r : '', done: false }); haptic(); changed();
  },
  'warm-add'(d) {
    if (topSheet() && topSheet().id === 'ex-menu') closeSheet(topSheet());
    const ex = state.workout.ex[Number(d.x)], at = ex.sets.filter(s => s.warm).length;
    ex.sets.splice(at, 0, { w: '', r: '', done: false, warm: true }); haptic(); changed();
  },
  'set-menu'(d) { setMenu(Number(d.x), Number(d.i)); },
  'set-type'(d) {
    const ex = state.workout && state.workout.ex[Number(d.x)], s = ex && ex.sets[Number(d.i)]; if (!s) return;
    s.warm = d.v === 'w'; if (s.warm) { delete s.rpe; delete s.type; } else if (d.v === 'n') delete s.type; else s.type = d.v;
    if (d.v === 'f') s.rpe = 10;
    ex.sets = ex.sets.filter(x => x.warm).concat(ex.sets.filter(x => !x.warm));
    haptic(); changed(); closeSheet(topSheet());
  },
  'set-rpe'(d) {
    const ex = state.workout && state.workout.ex[Number(d.x)], s = ex && ex.sets[Number(d.i)]; if (!s) return;
    if (d.v === '') delete s.rpe; else s.rpe = Number(d.v);
    haptic(); changed(); closeSheet(topSheet());
  },
  'set-del'(d) {
    const ex = state.workout && state.workout.ex[Number(d.x)]; if (!ex || ex.sets.length < 2) return;
    ex.sets.splice(Number(d.i), 1); changed(); closeSheet(topSheet());
  },
  'ex-note'(d) { if (topSheet() && topSheet().id === 'ex-menu') closeSheet(topSheet()); exNoteSheet(Number(d.x)); },
  'ex-rest'(d) {
    const ex = state.workout && state.workout.ex[Number(d.x)]; if (!ex) return;
    const keepNote = document.querySelector('[data-exnote]')?.value;
    state.settings.restByEx = { ...(state.settings.restByEx || {}) };
    if (Number(d.v) > 0) state.settings.restByEx[ex.n] = Number(d.v); else delete state.settings.restByEx[ex.n];
    haptic(); changed({ now: true }); topSheet()?.refresh();
    const t = document.querySelector('[data-exnote]'); if (t && keepNote != null) t.value = keepNote;
  },
  'use-deload'(d) { const ex = state.workout && state.workout.ex[Number(d.x)]; if (!ex) return; ex.deloadW = Number(d.w); haptic(); changed(); },
  'swap-ex'(d) {
    const W = state.workout, x = Number(d.x), old = W && W.ex[x]; const meta = exFromLib(d.n); if (!old || !meta) return;
    W.ex[x] = { ...newExercise(meta, old.sets.filter(isWork).length || 3), ss: old.ss };
    haptic(); changed();
    toast(old.n + ' → ' + meta.n, 'Undo', () => { W.ex[x] = old; changed(); });
  },
  'ex-note-save'(d) {
    const ex = state.workout && state.workout.ex[Number(d.x)]; if (!ex) return;
    ex.note = (document.querySelector('[data-exnote]')?.value || '').trim().slice(0, 200);
    changed({ now: true }); closeSheet(topSheet());
  },
  'ss-link'(d) {
    if (topSheet() && topSheet().id === 'ex-menu') closeSheet(topSheet());
    const W = state.workout, x = Number(d.x), a = W.ex[x], b = W.ex[x + 1]; if (!a || !b) return;
    if (a.ss && a.ss === b.ss) {
      const k = a.ss, fresh = nextSsLetter(W);
      for (let j = x + 1; j < W.ex.length && W.ex[j].ss === k; j++) W.ex[j].ss = fresh;
      [k, fresh].forEach(g => { const m = W.ex.filter(e => e.ss === g); if (m.length < 2) m.forEach(e => { delete e.ss; }); });
    } else {
      const k = a.ss || b.ss || nextSsLetter(W);
      const old = b.ss; if (old && old !== k) W.ex.forEach(e => { if (e.ss === old) e.ss = k; });
      a.ss = k; b.ss = k;
    }
    haptic(); changed();
  },
  plates(d) { if (topSheet() && topSheet().id === 'ex-menu') closeSheet(topSheet()); platesSheet(Number(d.x)); },
  'pl-step'(d) { plTarget = Math.max(0, Math.round((plTarget + Number(d.d)) * 100) / 100); haptic(); topSheet()?.refresh(); },
  'pl-bar'(d) { state.settings.bar = Number(d.v); changed({ now: true }); topSheet()?.refresh(); },
  'ex-hist'(d) { exHistSheet(d.n); },
  'exh-seg'(d) { const s = topSheet(); if (s && s.seg) s.seg(d.seg); },
  'session-edit'(d) { const w = view().workouts.find(x => (x.id || x.ts) === d.key); if (w) editSession(w); },
  'session-del'(d) {
    const w = view().workouts.find(x => (x.id || x.ts) === d.key); if (!w) return;
    if (!confirm('Delete the ' + fmtDay(w.date, { weekday: 'long', day: 'numeric', month: 'short' }) + ' session? ARK on your PC keeps a copy you can restore.')) return;
    closeSheet(topSheet());
    emitUndoable('workout.del', { key: d.key }, 'Session deleted');
  },
  'routine-from-workout'() { const W = state.workout; if (W) routineSheet(W.ex, W.name && W.name !== defaultName() ? W.name : ''); },
  'routine-from-session'(d) {
    const w = view().workouts.find(x => (x.id || x.ts) === d.key); if (!w) return;
    routineSheet(w.exercises, w.name || (w.type || '').replace(/^./, c => c.toUpperCase()) + ' day');
  },
  'routine-save'() {
    const name = (document.querySelector('[data-rt-name]')?.value || '').trim();
    if (!name) { toast('Name the template'); return; }
    if ((view().routines || []).some(r => r.name === name)) { toast('You already have a template called ' + name); return; }
    emit('routine.add', { routine: { name, ex: rtEx } });
    closeSheet(topSheet());
    if (rtFromTemplateMode && state.workout && state.workout.template) { state.workout = null; closeSheet(topSheet()); changed({ now: true }); }
    haptic(); toast('Template saved · ' + name);
  },
  'set-done'(d) {
    unlockAudio();
    const W = state.workout, x = Number(d.x), ex = W.ex[x], i = Number(d.i), s = ex.sets[i];
    if (s.done) { s.done = false; changed(); return; }
    const ph = placeholder(ex, i);
    if (s.w === '' && ph.w !== '') s.w = ph.w;
    if (s.r === '' && ph.r !== '') s.r = String(ph.r);
    if (s.w === '' || s.r === '') { toast('Enter weight and reps'); return; }
    s.done = true; haptic();
    // No rest after a warm-up, mid-superset, while building a template or fixing an old session.
    if (!s.warm && !W.edit && !W.template && ssEnd(W, x) === x) { const sec = restFor(ex); W.restEnd = Date.now() + sec * 1000; W.restTotal = sec; }
    changed({ now: true }); restTick();
  },
  'rest-adj'(d) {
    const W = state.workout; if (!W || !W.restEnd) return;
    W.restEnd = Math.max(Date.now() + 1000, W.restEnd + Number(d.d) * 1000);
    W.restTotal = Math.max(1, (W.restTotal || 0) + Number(d.d));
    haptic(); restTick();
  },
  'rest-skip'() {
    if (state.workout) { state.workout.restEnd = 0; changed({ silent: true }); }
    clearInterval(restTm); restTm = null;
    const bar = document.querySelector('[data-restbar]'); if (bar) { bar.hidden = true; bar.innerHTML = ''; }
    document.querySelectorAll('[data-rest]').forEach(el => { el.textContent = ''; });
  },
  'workout-finish'() { finish(); },
  'workout-cancel'() {
    const W = state.workout; if (!W) return;
    const sets = W.ex.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
    if (W.edit) { if (!confirm('Discard your changes? The session stays as it was.')) return; }
    else if (sets && !confirm('Cancel this workout? ' + sets + ' logged set' + (sets === 1 ? '' : 's') + ' will be lost.')) return;
    state.workout = null; closeSheet(topSheet()); actions['rest-skip'](); changed({ now: true });
  },
  'session-sheet'(d) { sessionSheet(Number(d.i)); },
};
/** Typing into a set, the name or the notes updates state without redrawing (keeps focus and the keyboard). */
export function onSetInput(el) {
  const W = state.workout; if (!W) return;
  if (el.matches('[data-wo-name]')) { W.name = el.value.slice(0, 60); changed({ silent: true }); return; }
  if (el.matches('[data-wo-notes]')) { W.notes = el.value.slice(0, 400); changed({ silent: true }); return; }
  const s = W.ex[Number(el.dataset.x)] && W.ex[Number(el.dataset.x)].sets[Number(el.dataset.i)]; if (!s) return;
  s[el.dataset.set] = el.value.replace(',', '.').trim();
  changed({ silent: true });
}
