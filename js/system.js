/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — the System: daily quests, today's plan, the fatigue radar,
   experiments, the weekly System Report, dungeons, muscle stories, what-if
   and progress photos. Every number comes from ARK_LOGIC (logic/src: planner,
   quests, fatigue, experiments, report, progression, whatif) — the same
   functions the PC runs — or from the engine itself for the what-if.
   ══════════════════════════════════════════════════════════════════════ */
import {
  L, state, view, emit, emitUndoable, dropPending, changed, esc, icon, today, shiftDay, fmt1, fmtDay, haptic, toast, openSheet, topSheet, closeSheet,
} from './core.js';
import { tissueNow, startPlan } from './train.js';

const card = (inner, cls = '') => `<section class="card frost ${cls}">${inner}</section>`;
const mName = s => (window.ARK_MNAME || {})[s] || s;
const bodyweight = v => { const k = Object.keys(v.weights || {}).sort().pop(); return k ? v.weights[k] : (v.profile || {}).weight || null; };

/* ── today's plan & fatigue ── */
let planKey = '', planCache = null, fatKey = '', fatCache = null;
export function fatigueNow(v = view()) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + today();
  if (fatCache && fatKey === k) return fatCache;
  let acwr = null; try { acwr = tissueNow().acwr; } catch (e) { /* no tissue yet */ }
  fatCache = L.fatigueRadar({ today: today(), bio: v.bio || {}, readiness: v.readiness || {}, sessions: v.workouts || [], acwr,
    sore: (v.body.muscles || []).filter(m => (m.soreness || 0) >= 2).length });
  fatKey = k; return fatCache;
}
export function planNow(v = view()) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + today();
  if (planCache && planKey === k) return planCache;
  const lib = [], seen = new Set();
  const add = e => { if (e && e.n && !seen.has(e.n)) { seen.add(e.n); lib.push({ n: e.n, c: e.c, g: e.g, m: e.m || [], e: e.e || 'other' }); } };
  (v.workouts || []).slice().reverse().forEach(w => (w.exercises || []).forEach(add));
  (v.exercises || []).forEach(add); L.EXERCISES.forEach(add);
  planCache = L.planWorkout({ muscles: v.body.muscles || [], library: lib, sessions: v.workouts || [], today: today(),
    injuries: L.activeInjuries(v.injuries || [], today()), fatigue: fatigueNow(v).level, step: v.unit === 'lb' ? 5 : 2.5 });
  planKey = k; return planCache;
}
export function planCard(v = view()) {
  const P = planNow(v), F = fatigueNow(v);
  if (P.rest) return card(`<span class="eyebrow">Today</span><b style="display:block;font-size:1.05rem;margin-top:2px">Recovery day</b><span class="sub">${esc(P.note || '')}</span>`, 'plan-card');
  return `<section class="card frost plan-card"><div class="row" style="align-items:flex-start"><div style="flex:1;min-width:0"><span class="eyebrow" style="color:#40c8e0">⚡ Today's plan</span>
      <b style="display:block;font-size:1.08rem;margin-top:2px">${esc(P.title)}</b>
      <span class="sub">${P.sets} hard sets · ~${P.minutes} min${F.level === 'deload' || F.level === 'strained' ? ` · <span style="color:${F.color}">${esc(F.title)}</span>` : ''}</span></div></div>
    <div class="plan-ex">${P.exercises.map(e => `<div><span>${esc(e.n)}</span><span class="num">${e.sets} × ${e.target && e.target.w ? fmt1(e.target.w) + ' × ' + e.target.r : e.target ? e.target.r + ' reps' : 'new'}</span></div>`).join('')}</div>
    ${P.note ? `<p class="sub" style="color:#ff9f0a;margin:8px 0 0">${esc(P.note)}</p>` : ''}
    <button class="btn btn-prominent block" style="margin-top:12px;--accent:#40c8e0" data-act="start-plan">Start plan</button></section>`;
}

/* ── daily quests ── */
function questData(v, day) {
  return { day, now: Date.now(), workouts: v.workouts || [], bio: v.bio || {}, weights: v.weights || {}, doses: v.doses || [], habitLog: v.habitLog || {},
    journal: v.journal || [], measures: v.measures || {} };
}
export function questsNow(v = view()) {
  const t = today();
  if (v.quests && v.quests.day === t && Array.isArray(v.quests.list) && v.quests.list.length) return v.quests.list;
  // This phone sees the day first: write the list and send it, so the PC keeps the same one.
  const list = L.dailyQuests({ today: t, now: Date.now(), plan: planNow(v), fatigue: fatigueNow(v).level, goals: ((v.bioDefs || {}).goals) || {},
    bio: v.bio || {}, weights: v.weights || {}, doses: v.doses || [], habits: (v.habits || []).length, bedtime: L.bedtimeFor(v.bio || {}, t),
    experiments: v.experiments || [], measures: v.measures || {} });
  if (!state.pending.some(e => e.type === 'quests.set' && e.data && e.data.day === t)) setTimeout(() => emit('quests.set', { day: t, list }), 0);
  return list;
}
export function questsCard(v = view()) {
  const list = questsNow(v), D = questData(v, today());
  const rows = list.map(q => ({ q, p: L.questProgress(q, D) }));
  const done = rows.filter(r => r.p.done).length, Y = v.quests && v.quests.day === today() ? v.quests.yesterday : null;
  const xp = (v.quests && v.quests.xp) || 0, streak = (v.quests && v.quests.streak) || 0;
  return `<section class="card frost quests">
    <div class="q-h"><span class="q-hex">⬡</span><b>Daily Quests</b><span class="q-n">${done}/${list.length}</span><span class="q-xp">${xp.toLocaleString()} XP</span></div>
    ${Y && Y.total && Y.done < Y.total ? `<div class="q-pen">⚠ PENALTY ZONE — yesterday ${Y.total - Y.done} of ${Y.total} failed: ${esc(Y.missed.join(' · '))}</div>` : streak ? `<div class="q-streak">◆ ${streak}-day clear streak</div>` : ''}
    ${rows.map(({ q, p }) => `<div class="q-r${p.done ? ' done' : p.failed ? ' fail' : ''}"><span class="q-ic">${q.ic}</span>
      <div class="q-b"><div class="q-t">${esc(q.name)}</div><div class="q-bar"><i style="width:${Math.round(p.cur / q.goal * 100)}%"></i></div>
        <div class="q-l">${esc(p.label)}${q.why && !p.done ? ' · ' + esc(q.why) : ''}</div>
        ${q.kind === 'train' && !p.done ? `<button class="chip" style="margin-top:6px" data-act="start-plan">▶ Start today's plan</button>` : ''}</div>
      <span class="q-x">${p.done ? '✓' : p.failed ? '✕' : '+' + q.xp}</span></div>`).join('')}
    ${list.length && done === list.length ? '<div class="q-clear">◆ ALL QUESTS CLEARED — day secured</div>' : ''}</section>`;
}

/* ── body: fatigue radar, dungeons, muscle story ── */
export function fatigueCard(v) {
  const F = fatigueNow(v);
  return `<div class="ba-h"><h2 style="font-size:1.05rem">Fatigue radar</h2><span class="k">${F.firing} of ${F.measured} signals firing</span></div>`
    + card(`<div style="border-left:3px solid ${F.color};padding-left:10px;margin-bottom:8px"><b style="color:${F.color}">${esc(F.title)}</b><div class="sub" style="line-height:1.45;margin-top:2px">${esc(F.text)}</div></div>
      ${F.signals.map(s => `<div class="sig"><i style="background:${s.on === null ? 'var(--fill-2)' : s.on ? '#ff9f0a' : '#30d158'}"></i><b>${esc(s.label)}</b><span>${esc(s.on === null ? 'not measured — ' + s.detail : s.detail)}</span></div>`).join('')}`);
}
export function dungeonCard(v) {
  const D = L.dungeons(v.workouts || [], Number(bodyweight(v)) || null, (v.profile || {}).sex || null);
  return `<div class="ba-h"><h2 style="font-size:1.05rem">Dungeons</h2><span class="k">strength gates E → S</span></div>`
    + card(!D.length ? `<div class="empty" style="padding:6px">Add your body weight — every gate is a multiple of it.</div>`
      : `<div class="dg">${D.map(d => `<div class="dgc"><div class="dg-h"><b>${esc(d.boss)}</b><span>${esc(d.name)}</span></div>
          <div class="gates">${d.gates.map(g => `<span class="${g.cleared ? 'clr' : d.next && d.next.rank === g.rank ? 'open' : ''}">${g.rank}</span>`).join('')}</div>
          <div class="dg-n">${!d.started ? 'Not entered yet' : d.next ? 'Gate ' + d.next.rank + ' · ' + d.next.need + ' kg · ' + d.next.pct + ' %' : 'All gates cleared'}</div></div>`).join('')}</div>
        <p class="sub" style="line-height:1.4;margin:8px 0 0">Multiples of the population standard at your body weight (0.5× → 1.8×), cleared on the real day you lifted it.</p>`);
}
export function storyBlock(v, slug) {
  const S = L.muscleStory(v.workouts || [], slug, today(), v.injuries || [], 13, Number(bodyweight(v)) || null);
  const m = (v.body.muscles || []).find(x => x.slug === slug) || {}, V = m.vol, top = Math.max(S.peak, V ? V.mavHi : 10, 1);
  return `<div class="grp-h" style="margin-top:16px">90-day arc</div><div class="story frost">
    <div class="sbars">${V ? `<i class="band" style="bottom:${Math.round(V.mavLo / top * 52)}px;height:${Math.max(2, Math.round((V.mavHi - V.mavLo) / top * 52))}px"></i>` : ''}
      ${S.weeks.map(w => `<span class="${w.injured ? 'inj' : ''}"><i style="height:${Math.max(2, Math.round(w.sets / top * 52))}px"></i></span>`).join('')}</div>
    <p class="sub" style="line-height:1.45;margin:8px 0 0">${S.lines.map(esc).join(' ')}</p></div>`;
}

/* ── progress photos: on this phone only (IndexedDB), never synced ── */
let phDbP = null;
const phDb = () => phDbP || (phDbP = new Promise((res, rej) => { const r = indexedDB.open('ark-photos', 1); r.onupgradeneeded = () => r.result.createObjectStore('p', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const phAll = () => phDb().then(db => new Promise(res => { const o = [], c = db.transaction('p').objectStore('p').openCursor(); c.onsuccess = () => { const x = c.result; if (x) { o.push(x.value); x.continue(); } else res(o.sort((a, b) => a.day < b.day ? -1 : 1)); }; }));
const phPut = rec => phDb().then(db => new Promise(res => { const t = db.transaction('p', 'readwrite'); t.objectStore('p').put(rec); t.oncomplete = res; }));
const phDel = id => phDb().then(db => new Promise(res => { const t = db.transaction('p', 'readwrite'); t.objectStore('p').delete(id); t.oncomplete = res; }));
const ph = { pose: 'front', urls: [], stream: null, facing: 'user' };
const shrink = src => new Promise((res, rej) => { const img = new Image(); img.onload = () => { const s = Math.min(1, 1080 / Math.max(img.width, img.height)), c = document.createElement('canvas');
  c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); c.toBlob(b => res({ blob: b, w: c.width, h: c.height }), 'image/jpeg', 0.85); };
  img.onerror = rej; img.src = typeof src === 'string' ? src : URL.createObjectURL(src); });
export function photoCard() {
  setTimeout(photoRender, 0);
  return `<div class="ba-h"><h2 style="font-size:1.05rem">Progress photos</h2><span class="k">this phone only</span></div>`
    + card(`<div class="chips" style="margin-bottom:10px">${['front', 'side', 'back'].map(p => `<button class="chip ${ph.pose === p ? 'on' : ''}" data-act="ph-pose" data-p="${p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
      <div id="ph-host" class="sub">Loading…</div>
      <div class="row" style="gap:8px;margin-top:10px"><button class="btn btn-tint" style="flex:1;--accent:#40c8e0" data-act="ph-cam">${icon('camera', 16)} Take with guide</button>
        <label class="btn btn-glass" style="flex:1">From library<input type="file" accept="image/*" style="display:none" data-ph-file></label></div>
      <p class="sub" style="line-height:1.4;margin:8px 0 0">The guide shows your last ${ph.pose} photo faintly over the camera, so every photo lines up. Photos never leave this phone.</p>`);
}
function photoRender() {
  const host = document.getElementById('ph-host'); if (!host) return;
  phAll().then(all => {
    ph.urls.forEach(u => URL.revokeObjectURL(u)); ph.urls = [];
    const Lp = all.filter(p => p.pose === ph.pose), url = p => { const u = URL.createObjectURL(p.blob); ph.urls.push(u); return u; };
    if (!Lp.length) { host.innerHTML = 'No ' + ph.pose + ' photos yet.'; return; }
    const a = Lp[0], b = Lp[Lp.length - 1];
    host.innerHTML = (Lp.length > 1 ? `<div class="cmp"><img src="${url(a)}" alt=""><div class="cmp-top" style="width:50%"><img src="${url(b)}" alt=""></div>
        <input type="range" min="0" max="100" value="50" data-ph-cmp aria-label="Compare"><span class="l">${fmtDay(a.day, { day: 'numeric', month: 'short' })}</span><span class="r">${fmtDay(b.day, { day: 'numeric', month: 'short' })}</span></div>` : '')
      + `<div class="thumbs">${Lp.map(p => `<figure><img src="${url(p)}" alt=""><figcaption>${fmtDay(p.day, { day: 'numeric', month: 'short' })}<button data-act="ph-del" data-id="${p.id}" aria-label="Delete">✕</button></figcaption></figure>`).join('')}</div>`;
  }).catch(() => { host.textContent = 'Photo storage is blocked in this browser.'; });
}
export function onPhotoInput(el) {
  if (el.matches('[data-ph-cmp]')) { const t = el.parentNode.querySelector('.cmp-top'); if (t) t.style.width = el.value + '%'; return true; }
  if (el.matches('[data-ph-file]') && el.files && el.files[0]) {
    shrink(el.files[0]).then(r => phPut({ id: 'ph' + Date.now().toString(36), day: today(), pose: ph.pose, blob: r.blob, w: r.w, h: r.h })).then(() => { toast('📸 Saved on this phone'); photoRender(); });
    return true;
  }
  return false;
}
function camStop() { if (ph.stream) { ph.stream.getTracks().forEach(t => t.stop()); ph.stream = null; } }
function cameraSheet() {
  openSheet({
    id: 'ph-cam', title: 'Progress photo · ' + ph.pose, onClose: camStop,
    render: () => `<div class="camwrap"><video id="ph-video" playsinline muted autoplay></video><img id="ph-ghost" alt=""><div id="ph-count"></div></div>
      <div class="row" style="gap:8px;margin-top:12px"><button class="btn btn-glass" data-act="ph-flip">${icon('sync', 16)} Flip</button>
        <button class="btn btn-prominent" style="flex:1;--accent:#40c8e0" data-act="ph-shoot">Capture in 3 s</button></div>
      <p class="sub" style="text-align:center;margin-top:8px">Line yourself up with the faint outline of last time.</p>`,
  });
  camStart();
}
function camStart() {
  camStop();
  navigator.mediaDevices.getUserMedia({ video: { facingMode: ph.facing, width: { ideal: 1440 }, height: { ideal: 1920 } }, audio: false }).then(s => {
    ph.stream = s; const vEl = document.getElementById('ph-video'); if (!vEl) return camStop();
    vEl.srcObject = s; vEl.style.transform = ph.facing === 'user' ? 'scaleX(-1)' : '';
    phAll().then(all => { const last = all.filter(p => p.pose === ph.pose).pop(), g = document.getElementById('ph-ghost');
      if (last && g) { const u = URL.createObjectURL(last.blob); ph.urls.push(u); g.src = u; g.style.display = 'block'; } });
  }).catch(() => { toast('Camera access is off — use "From library" instead'); closeSheet(topSheet()); });
}
function camShoot() {
  let n = 3; const c = document.getElementById('ph-count');
  const tick = () => {
    if (!ph.stream) return;
    if (n > 0) { if (c) c.textContent = n; n--; setTimeout(tick, 1000); return; }
    if (c) c.textContent = '';
    const vEl = document.getElementById('ph-video'); if (!vEl || !vEl.videoWidth) return;
    const cv = document.createElement('canvas'); cv.width = vEl.videoWidth; cv.height = vEl.videoHeight;
    const cx = cv.getContext('2d'); if (ph.facing === 'user') { cx.translate(cv.width, 0); cx.scale(-1, 1); } cx.drawImage(vEl, 0, 0);
    shrink(cv.toDataURL('image/jpeg', 0.92)).then(r => phPut({ id: 'ph' + Date.now().toString(36), day: today(), pose: ph.pose, blob: r.blob, w: r.w, h: r.h }))
      .then(() => { haptic(); toast('📸 Saved on this phone'); closeSheet(topSheet()); photoRender(); });
  };
  tick();
}

/* ── what-if: the same engine as the PC, in a worker ── */
let engW = null, engSeq = 0; const engCb = {};
function engine() {
  if (engW) return Promise.resolve(engW);
  return fetch('ark-engine.js').then(r => r.text()).then(src => {
    const blob = new Blob([src + '\nself.onmessage=function(e){var d=e.data;try{self.postMessage({seq:d.seq,ok:true,report:self.ARK_ENDOCRINE.estimateEndocrineState(d.history,d.options)});}catch(err){self.postMessage({seq:d.seq,ok:false,error:String(err&&err.message||err)});}};'], { type: 'text/javascript' });
    engW = new Worker(URL.createObjectURL(blob));
    engW.onmessage = e => { const c = engCb[e.data.seq]; delete engCb[e.data.seq]; if (c) c(e.data); };
    return engW;
  });
}
const runEngine = (history, options) => engine().then(w => new Promise(res => { const s = ++engSeq; engCb[s] = res; w.postMessage({ seq: s, history, options }); }));
const wi = { weeks: 6, over: {}, out: '' };
function whatIfSheet() {
  const v = view(), hist = ((v.endo || {}).inputs) || [], base = L.baselineInputs(hist);
  wi.over = {}; wi.out = '';
  openSheet({
    id: 'whatif', title: 'What if…',
    render: () => !hist.length ? `<div class="empty">The engine needs logged days first — and ARK on your PC sends them with the next sync.</div>`
      : `<p class="sub" style="line-height:1.45;margin:0 0 12px">Sliders start at your last two weeks. Simulate runs the hormone engine on <b>as is</b> and on <b>your change</b>, from your real history forward. A model estimate with its uncertainty — not a promise.</p>
        ${L.WHATIF_LEVERS.map(l => { const val = wi.over[l.k] ?? base[l.k]; const on = val !== undefined; return `<label class="wi-r ${on ? '' : 'off'}"><span>${esc(l.label)}</span>
          <input type="range" min="${l.min}" max="${l.max}" step="${l.step}" value="${on ? val : l.min}" data-wi="${l.k}"><b class="num" data-wi-v="${l.k}">${on ? Math.round(val * 100) / 100 + ' ' + l.unit : 'not logged'}</b></label>`; }).join('')}
        <div class="chips" style="margin:12px 0">${[4, 6, 8, 12].map(w => `<button class="chip ${wi.weeks === w ? 'on' : ''}" data-act="wi-weeks" data-w="${w}">${w} weeks</button>`).join('')}</div>
        <button class="btn btn-prominent block" style="--accent:#bf5af2" data-act="wi-run">Simulate</button><div id="wi-out" style="margin-top:12px">${wi.out}</div>`,
  });
}
export function onWhatIfInput(el) {
  if (!el.matches('[data-wi]')) return false;
  const k = el.dataset.wi, l = L.WHATIF_LEVERS.find(x => x.k === k);
  wi.over[k] = Number(el.value); el.parentNode.classList.remove('off');
  const b = document.querySelector('[data-wi-v="' + k + '"]'); if (b) b.textContent = el.value + ' ' + l.unit;
  return true;
}
function whatIfRun() {
  const v = view(), hist = ((v.endo || {}).inputs) || [], out = document.getElementById('wi-out');
  if (!Object.keys(wi.over).length) { toast('Move at least one slider'); return; }
  const W = L.whatIfHistories(hist, wi.over, wi.weeks), opt = { samples: 100, seed: 4242 };
  if (out) out.innerHTML = '<div class="sub" style="text-align:center">Simulating ' + wi.weeks + ' weeks, twice…</div>';
  Promise.all([runEngine(W.asIs, opt), runEngine(W.scenario, opt)]).then(([a, b]) => {
    if (!a.ok || !b.ok) { wi.out = '<div class="sub">The engine could not run: ' + esc((a.error || b.error || '')) + '</div>'; }
    else {
      const C = L.compareReports(a.report, b.report), names = Object.fromEntries((((v.endo || {}).axes) || []).map(x => [x.k, x.name]));
      const inv = k => k === 'cortisol' || k === 'stressLoad' || k === 'recoveryDebt';
      const row = (r, label) => { const good = inv(r.k) ? r.d < 0 : r.d > 0, col = !r.clear ? 'var(--t3)' : good ? '#30d158' : '#ff9f0a';
        return `<div class="wi-o"><span>${esc(label)}</span><span class="num">${r.asIs} → <b style="color:${col}">${r.scenario}</b></span><i style="color:${col}">${r.d > 0 ? '+' : ''}${r.d}${r.clear ? '' : ' · noise'}</i></div>`; };
      wi.out = `<div class="grp-h">After ${wi.weeks} weeks</div><section class="frost wi-box">${C.hormones.map(r => row(r, names[r.k] || r.k)).join('')}</section>
        <div class="grp-h">Recovery</div><section class="frost wi-box">${C.derived.filter(r => ['recoveryCapacity', 'stressLoad', 'anabolicBalance', 'recoveryDebt'].includes(r.k)).map(r => row(r, r.k.replace(/([A-Z])/g, ' $1').toLowerCase())).join('')}</section>`;
    }
    const s = topSheet(); if (s && s.id === 'whatif') s.refresh();
  });
}

/* ── experiments (Grow → Lab) ── */
const expData = v => ({ bio: v.bio || {}, readiness: v.readiness || {}, weights: v.weights || {}, doses: v.doses || [] });
export function renderLab() {
  const v = view(), t = today(), X = (v.experiments || []).slice().reverse();
  let H = `<p class="sub" style="line-height:1.45;margin:0 2px 12px">Test one change at a time. ARK compares up to 4 weeks before the start with the days since, and calls a change clear only when it beats your normal day-to-day noise.</p>`;
  H += X.length ? X.map(e => {
    const R = L.experimentReport(e, expData(v), t);
    return `<section class="card frost exp"><div class="row"><div style="flex:1;min-width:0"><b>🧪 ${esc(e.name)}</b><div class="sub">${esc(R.status)}${R.adherence !== null ? ' · taken on ' + R.adherence + ' % of days' : ''}</div></div>
        <button class="chip" data-act="exp-menu" data-id="${esc(e.id)}">•••</button></div>
      ${R.metrics.map(m => { const col = m.verdict === 'better' ? '#30d158' : m.verdict === 'worse' ? '#ff453a' : m.verdict === 'changed' ? '#64d2ff' : 'var(--t3)';
        return `<div class="exp-r"><span>${esc(m.label)}</span><span class="num">${m.before ?? '—'} → ${m.after ?? '—'}</span><span style="color:${col}">${esc(m.text)}</span></div>`; }).join('')}
      <p class="sub" style="line-height:1.4;margin:8px 0 0">${esc(R.caveat)}</p></section>`;
  }).join('') : card(`<div class="empty" style="padding:6px">No experiments yet.</div>`);
  return H + `<button class="btn btn-prominent block" style="margin-top:12px;--accent:#bf5af2" data-act="exp-new">${icon('plus', 16)} New experiment</button>`;
}
let expDraft = null;
function expSheet() {
  expDraft = { id: 'exp' + Date.now().toString(36), name: '', dose: null, start: today(), days: 28, metrics: [] };
  openSheet({
    id: 'exp', title: 'New experiment',
    render: () => {
      const D = expDraft;
      return `<div class="grp-h" style="margin-top:0">Start from</div><div class="chips">${L.EXP_TEMPLATES.map((x, i) => `<button class="chip ${D.name === x.name ? 'on' : ''}" data-act="exp-tpl" data-i="${i}">${esc(x.name)}</button>`).join('')}</div>
        <label class="field" style="margin-top:14px"><span>What are you testing?</span><input class="inp" maxlength="80" value="${esc(D.name)}" data-exp="name"></label>
        <label class="field"><span>Dose that counts as taking it</span><select class="inp" data-exp="dose"><option value="">None — not a supplement</option>${Object.keys(L.PK).filter(k => !['alcohol', 'nicotine'].includes(k)).map(k => `<option value="${k}" ${D.dose === k ? 'selected' : ''}>${esc(L.PK[k].name)}</option>`).join('')}</select></label>
        <div class="grid2"><label class="field"><span>Days</span><input class="inp num" type="number" min="7" max="120" value="${D.days}" data-exp="days"></label>
          <label class="field"><span>Starting</span><input class="inp" type="date" max="${today()}" value="${D.start}" data-exp="start"></label></div>
        <div class="field"><span>Measure</span><div class="chips">${Object.keys(L.EXP_METRICS).map(k => `<button class="chip ${D.metrics.includes(k) ? 'on' : ''}" data-act="exp-met" data-k="${k}">${esc(L.EXP_METRICS[k].label)}</button>`).join('')}</div></div>
        <button class="btn btn-prominent block" style="--accent:#bf5af2" data-act="exp-save">Start experiment</button>`;
    },
  });
}
function expRead() {
  const g = k => document.querySelector('[data-exp="' + k + '"]');
  if (g('name')) expDraft.name = g('name').value; if (g('dose')) expDraft.dose = g('dose').value || null;
  if (g('days')) expDraft.days = Number(g('days').value); if (g('start') && g('start').value) expDraft.start = g('start').value;
}

/* ── the System Report (top of "Your week") ── */
export function systemReportHtml(R) {
  const v = view();
  const X = (v.experiments || []).map(e => { const r = L.experimentReport(e, expData(v), today()), b = r.metrics.find(m => m.verdict === 'better' || m.verdict === 'worse');
    return { name: e.name, status: r.status, best: b ? b.label + ': ' + b.text.toLowerCase() : null }; });
  const S = L.systemReport(R, { axes: ((v.endo || {}).axes) || [], muscles: v.body.muscles || [], fatigue: fatigueNow(v),
    quests: (v.quests || {}).week || null, experiments: X, injuries: Object.keys(L.activeInjuries(v.injuries || [], today())).length });
  const tone = { good: '#30d158', warn: '#ff9f0a', bad: '#ff453a', '': 'var(--t2)' };
  return `<section class="card frost sysrep"><div class="sr-h">⬡ SYSTEM REPORT</div>${S.lines.map(l => `<div class="sr-l"><span>${l.ic}</span><span style="color:${tone[l.tone]}">${esc(l.text)}</span></div>`).join('')}
    ${S.focus.length ? `<div class="sr-f"><b>NEXT WEEK — ORDERS</b>${S.focus.map((f, i) => `<div>${i + 1}. ${esc(f)}</div>`).join('')}</div>` : ''}</section>`;
}

export const actions = {
  'start-plan'() { const P = planNow(); if (P.rest) { toast('Recovery day — ' + (P.note || 'nothing is ready')); return; } if (topSheet()) closeSheet(topSheet()); startPlan(P); },
  'whatif-open'() { whatIfSheet(); },
  'wi-weeks'(d) { wi.weeks = Number(d.w); const s = topSheet(); s && s.refresh(); },
  'wi-run'() { whatIfRun(); },
  'ph-pose'(d) { ph.pose = d.p; haptic(); changed(); },
  'ph-cam'() { cameraSheet(); },
  'ph-flip'() { ph.facing = ph.facing === 'user' ? 'environment' : 'user'; camStart(); },
  'ph-shoot'() { camShoot(); },
  'ph-del'(d) { if (!confirm('Delete this photo from this phone?')) return; phDel(d.id).then(photoRender); },
  'exp-new'() { expSheet(); },
  'exp-tpl'(d) { const x = L.EXP_TEMPLATES[Number(d.i)]; if (!x) return; Object.assign(expDraft, { name: x.name, dose: x.dose || null, days: x.days, metrics: x.metrics.slice() }); haptic(); const s = topSheet(); s && s.refresh(); },
  'exp-met'(d) { expRead(); const i = expDraft.metrics.indexOf(d.k); if (i >= 0) expDraft.metrics.splice(i, 1); else expDraft.metrics.push(d.k); const s = topSheet(); s && s.refresh(); },
  'exp-save'() {
    expRead();
    const x = L.cleanExperiment(expDraft);
    if (!x) { toast('Name it, pick at least one measure, 7–120 days'); return; }
    emit('experiment.set', { experiment: x }); closeSheet(topSheet()); haptic(); toast('🧪 Started — ' + x.name);
  },
  'exp-menu'(d) {
    const e = (view().experiments || []).find(x => x.id === d.id); if (!e) return;
    openSheet({ id: 'exp-menu', title: e.name, render: () => `<button class="btn btn-tint block" style="--accent:#ff9f0a" data-act="exp-stop" data-id="${esc(e.id)}" ${e.stopped ? 'disabled' : ''}>Stop it now</button>
      <button class="btn btn-glass block" style="margin-top:10px" data-act="exp-del" data-id="${esc(e.id)}">Delete</button>` });
  },
  'exp-stop'(d) { const e = (view().experiments || []).find(x => x.id === d.id); if (!e) return; emit('experiment.set', { experiment: L.cleanExperiment({ ...e, stopped: today() }) }); closeSheet(topSheet()); toast('Stopped'); },
  'exp-del'(d) {
    closeSheet(topSheet());
    const onPc = ((state.snapshot && state.snapshot.experiments) || []).some(x => x.id === d.id);
    if (!onPc) { state.pending.filter(e => !e.seq && e.type === 'experiment.set' && e.data.experiment && e.data.experiment.id === d.id).forEach(e => dropPending(e.id)); toast('Removed'); return; }
    if (!confirm('Delete this experiment? Your logged vitals are not touched.')) return;
    emitUndoable('experiment.del', { id: d.id }, 'Experiment deleted');
  },
};
