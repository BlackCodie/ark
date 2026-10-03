/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — the things that make it a daily app rather than a remote:
   creating habits, goals and skills; Apple Health via a Shortcut;
   notifications sent by your PC; appearance; fixing past entries.
   Every change is still an event the PC applies (logic/src/sync.ts).
   ══════════════════════════════════════════════════════════════════════ */
import {
  L, state, view, emit, emitUndoable, dropPending, changed, esc, icon, today, fmt1, fmtDay, fmtMins, ago,
  openSheet, closeSheet, topSheet, toast, haptic, hubBase, syncNow, copyText, applyTheme, pcAgeMin, pcAsOf,
} from './core.js';
import { PILLAR, pillarColor } from './views.js';
import { nextSetHint } from './train.js';

const LEVELS = ['Untrained', 'Novice', 'Competent', 'Proficient', 'Advanced', 'Expert'];
const GOAL_CATS = [['body', 'Body'], ['mind', 'Mind'], ['income', 'Income'], ['survival', 'Survival'], ['modern', 'Modern'], ['life', 'Life']];
const GOAL_TYPES = [['numeric', 'Numeric target'], ['checklist', 'Milestones'], ['consistency', 'Habit consistency'], ['manual', 'Self-assessed']];
const defs = () => view().defs || {};
const goalCats = () => defs().goalCats || GOAL_CATS;
const goalTypes = () => defs().goalTypes || GOAL_TYPES;
const pillars = () => (defs().pillars || Object.keys(PILLAR).filter(k => k !== 'custom' && k !== 'life').map(k => ({ k, name: PILLAR[k][0], icon: '' })));
const isCustomHabit = h => h.custom || /^hc-/.test(h.id);
const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30);
const val = sel => (document.querySelector(sel)?.value || '').trim();

/* ══════════════ "PC data as of…" ══════════════ */
/** A quiet line when what the phone shows is older than the PC's usual minute-by-minute publish. */
export function staleNote(min = 15) {
  const age = pcAgeMin();
  if (age === null || age < min) return '';
  return `<div class="stale" role="note">${icon('clock', 14)}<span>PC data as of ${esc(pcAsOf())}${age >= 360 ? ' — open ARK on your PC (or keep it in the tray) to refresh' : ''}</span></div>`;
}

/* ══════════════ create: habit ══════════════ */
const HABIT_ICONS = ['⭐', '💪', '🏃', '🧘', '📖', '🧠', '💧', '🥗', '😴', '🚶', '🎯', '💻', '✍️', '🎸', '🧹', '🌅', '🥶', '☀️'];
let hIcon = '⭐', hPillar = 'body', hEff = 'none', hMin = 0, hColor = null;
const H_KEEP = ['data-h-name', 'data-h-unit', 'data-h-amin', 'data-h-amax', 'data-h-astep'];
/** What ticking the habit feeds: minutes of light, cold, calm… (logic/routines.ts). */
function effectPicker() {
  const ch = L.EFFECT_CHOICES;
  const why = { none: 'Tracked for consistency only.', sunlight: 'Morning light → body-clock alignment: earlier cortisol peak, better sleep timing (mind + hormone models).',
    cold: 'Cold → a lasting dopamine and noradrenaline rise, stress adaptation.', meditation: 'Meditation / NSDR → calmer stress response, lower evening arousal.',
    walk: 'Walking → steps, insulin sensitivity, lower inflammation.', mobility: 'Mobility → counts toward joint and tissue care.', sauna: 'Sauna → heat-shock and growth-hormone pulse; cardiovascular fitness.' };
  return `<div class="eyebrow" style="margin:16px 0 8px">What it does</div>
    <div class="chips">${ch.map(([k, l]) => `<button class="chip ${hEff === k ? 'on' : ''}" data-act="h-eff" data-k="${k}">${esc(l)}</button>`).join('')}</div>
    ${hEff !== 'none' ? `<div class="stepper" style="margin-top:12px;justify-content:flex-start;gap:12px">
      <button class="circle sm btn-glass" data-act="h-min" data-d="-5" aria-label="Fewer minutes">${icon('minus', 16)}</button>
      <span class="val num" style="min-width:70px;text-align:center">${hMin} min</span>
      <button class="circle sm btn-glass" data-act="h-min" data-d="5" aria-label="More minutes">${icon('plus', 16)}</button></div>` : ''}
    <p class="sub" style="line-height:1.5;margin:10px 0 0">${esc(why[hEff] || '')}</p>`;
}
const effectOf = () => hEff === 'none' || !(hMin > 0) ? null : { [hEff]: hMin };
function loadEffect(e) {
  const k = e && Object.keys(e).find(x => e[x] > 0);
  hEff = k || 'none'; hMin = k ? e[k] : 0;
}
export function habitNewSheet() {
  hIcon = '⭐'; hPillar = (pillars()[0] || {}).k || 'body'; hEff = 'none'; hMin = 0;
  openSheet({
    id: 'habit-new', title: 'New habit',
    render: () => {
      const custom = view().habits.filter(isCustomHabit);
      return `<label class="field"><span>Habit</span><input class="inp" data-h-name maxlength="60" placeholder="e.g. Cold shower" autocomplete="off"></label>
        <div class="eyebrow" style="margin:4px 0 8px">Icon</div>
        <div class="emo-pick">${HABIT_ICONS.map(i => `<button class="${i === hIcon ? 'on' : ''}" data-act="h-icon" data-i="${i}" aria-label="Icon ${i}">${i}</button>`).join('')}</div>
        <div class="eyebrow" style="margin:16px 0 8px">Pillar</div>
        <div class="chips">${pillars().map(p => `<button class="chip ${p.k === hPillar ? 'on' : ''}" style="--accent:${pillarColor(p.k)}" data-act="h-pillar" data-k="${esc(p.k)}">${esc(PILLAR[p.k] ? PILLAR[p.k][0] : String(p.name).split(' — ')[0])}</button>`).join('')}</div>
        ${effectPicker()}
        <button class="btn btn-prominent block" style="margin-top:20px;--accent:#30d158" data-act="h-save">Add habit</button>
        ${custom.length ? `<div class="grp-h">Your habits</div><section class="list frost">${custom.map(h => `<div class="li"><span class="ic" style="--c:${pillarColor(h.pillar)}">${esc(h.icon || '•')}</span>
          <span class="tx"><div class="tt">${esc(h.name)}</div></span>
          <button class="circle sm" data-act="h-del" data-id="${esc(h.id)}" aria-label="Remove ${esc(h.name)}">${icon('trash', 16)}</button></div>`).join('')}</section>
          <p class="sub" style="margin-top:10px;line-height:1.5">Removing a habit keeps every day you already ticked. To change or hide any habit, tap its name in Habits.</p>` : ''}`;
    },
  });
  setTimeout(() => document.querySelector('[data-h-name]')?.focus(), 450);
}

/* ══════════════ edit: habit ══════════════ */
let editId = null;
export function habitEditSheet(id) {
  const h0 = view().habits.find(x => x.id === id); if (!h0) return;
  editId = id; hIcon = h0.icon || '⭐'; hPillar = h0.pillar || 'custom'; loadEffect(L.habitEffect(h0));
  hColor = h0.color || L.HABIT_COLORS[Math.max(0, view().habits.findIndex(x => x.id === id)) % L.HABIT_COLORS.length];
  const icons = HABIT_ICONS.includes(hIcon) ? HABIT_ICONS : [hIcon, ...HABIT_ICONS.slice(0, 17)];
  openSheet({
    id: 'habit-edit', title: 'Edit habit',
    render: () => {
      const v = view(), h = v.habits.find(x => x.id === editId);
      if (!h) return '<div class="empty">This habit is hidden or removed.</div>';
      const t = today(), days = [];
      for (let i = 0; i < 30; i++) days.push(L.shiftDayKey(t, -i));
      const n30 = days.filter(k => v.habitLog[k] && v.habitLog[k][h.id]).length;
      const streak = L.habitStreakOf(v.habitLog, h.id, t);
      return `<div class="stat3" style="margin-bottom:16px"><div class="frost"><div class="v num">${streak}</div><div class="k">Streak</div></div>
          <div class="frost"><div class="v num">${n30}</div><div class="k">Days · last 30</div></div>
          <div class="frost"><div class="v num">${Math.round(n30 / 30 * 100)}%</div><div class="k">30-day rate</div></div></div>
        <label class="field"><span>Name</span><input class="inp" data-h-name maxlength="60" value="${esc(h.name)}" autocomplete="off"></label>
        <div class="eyebrow" style="margin:4px 0 8px">Icon</div>
        <div class="emo-pick">${icons.map(i => `<button class="${i === hIcon ? 'on' : ''}" data-act="h-icon" data-i="${i}" aria-label="Icon ${i}">${i}</button>`).join('')}</div>
        <div class="eyebrow" style="margin:16px 0 8px">Colour</div>
        <div class="hb-sw">${L.HABIT_COLORS.map(c => `<button class="${c === hColor ? 'on' : ''}" style="--sw:${c}" data-act="h-color" data-c="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
        <div class="eyebrow" style="margin:16px 0 8px">Track an amount <span class="sub" style="text-transform:none;letter-spacing:0;font-weight:500">— leave the unit empty for a simple tick</span></div>
        <div class="hb-amtf"><label><span>Unit</span><input class="inp" data-h-unit maxlength="12" placeholder="min" value="${esc(h.unit || '')}"></label>
          <label><span>From</span><input class="inp" data-h-amin inputmode="decimal" placeholder="0.5" value="${h.amin != null ? esc(String(h.amin)) : ''}"></label>
          <label><span>To</span><input class="inp" data-h-amax inputmode="decimal" placeholder="5" value="${h.amax != null ? esc(String(h.amax)) : ''}"></label>
          <label><span>Step</span><input class="inp" data-h-astep inputmode="decimal" placeholder="0.5" value="${h.astep != null ? esc(String(h.astep)) : ''}"></label></div>
        <div class="eyebrow" style="margin:16px 0 8px">Pillar</div>
        <div class="chips">${pillars().map(p => `<button class="chip ${p.k === hPillar ? 'on' : ''}" style="--accent:${pillarColor(p.k)}" data-act="h-pillar" data-k="${esc(p.k)}">${esc(PILLAR[p.k] ? PILLAR[p.k][0] : String(p.name).split(' — ')[0])}</button>`).join('')}</div>
        ${effectPicker()}
        <button class="btn btn-prominent block" style="margin-top:20px;--accent:#30d158" data-act="h-edit-save">Save</button>
        <div class="row" style="gap:10px;margin-top:10px">
          <button class="btn btn-glass" style="flex:1" data-act="habit-hide" data-id="${esc(h.id)}">Hide</button>
          ${isCustomHabit(h) ? `<button class="btn btn-danger" style="flex:1" data-act="h-del" data-id="${esc(h.id)}">${icon('trash', 16)} Delete</button>` : ''}</div>
        <p class="sub" style="line-height:1.5;margin-top:12px">Hiding stops a habit counting toward your day without touching its history — show it again from the bottom of Habits. ${isCustomHabit(h) ? 'Deleting keeps every day you ticked, too.' : 'Built-in habits can be hidden, not deleted.'}</p>`;
    },
  });
}

/* ══════════════ create: skill ══════════════ */
let kCat = 'mind', kLevel = 0, kTarget = 3;
export function skillNewSheet() {
  kCat = 'mind'; kLevel = 0; kTarget = 3;
  openSheet({
    id: 'skill-new', title: 'New skill',
    render: () => `<label class="field"><span>Skill</span><input class="inp" data-k-name maxlength="80" placeholder="e.g. Guitar" autocomplete="off"></label>
      <div class="eyebrow" style="margin:4px 0 8px">Category</div>
      <div class="chips">${goalCats().map(c => `<button class="chip ${c[0] === kCat ? 'on' : ''}" style="--accent:${pillarColor(c[0])}" data-act="k-cat" data-k="${c[0]}">${esc(c[1])}</button>`).join('')}</div>
      <div class="eyebrow" style="margin:16px 0 8px">Where you are now</div>
      <div class="chips">${LEVELS.map((l, i) => `<button class="chip ${i === kLevel ? 'on' : ''}" data-act="k-level" data-v="${i}">${l}</button>`).join('')}</div>
      <div class="eyebrow" style="margin:16px 0 8px">Where you want to get</div>
      <div class="chips">${LEVELS.map((l, i) => `<button class="chip ${i === kTarget ? 'on' : ''}" ${i < kLevel ? 'disabled' : ''} data-act="k-target" data-v="${i}">${l}</button>`).join('')}</div>
      <label class="field" style="margin-top:16px"><span>Milestones — one per line (the proof of each level)</span><textarea class="inp" data-k-ms placeholder="Play 3 chords cleanly&#10;First full song"></textarea></label>
      <label class="field"><span>Why it matters (optional)</span><input class="inp" data-k-why maxlength="200" autocomplete="off"></label>
      <button class="btn btn-prominent block" style="--accent:#bf5af2" data-act="k-save">Add skill</button>
      <p class="sub" style="text-align:center;margin-top:12px;line-height:1.5">Levels are self-assessed and only change when you move them — hours logged never level you up.</p>`,
  });
  setTimeout(() => document.querySelector('[data-k-name]')?.focus(), 450);
}

/* ══════════════ create: goal ══════════════ */
let gCat = 'body', gType = 'numeric', gHabit = '';
export function goalNewSheet() {
  gCat = 'body'; gType = 'numeric'; gHabit = '';
  openSheet({
    id: 'goal-new', title: 'New goal',
    render: () => {
      const hs = view().habits;
      let fields = '';
      if (gType === 'numeric') fields = `<div class="row" style="gap:10px;align-items:flex-start">
          <label class="field" style="flex:1"><span>Now</span><input class="inp num" data-g-cur type="number" inputmode="decimal" placeholder="80"></label>
          <label class="field" style="flex:1"><span>Target</span><input class="inp num" data-g-tgt type="number" inputmode="decimal" placeholder="100"></label>
          <label class="field" style="flex:1"><span>Unit</span><input class="inp" data-g-unit maxlength="16" placeholder="kg"></label></div>`;
      if (gType === 'checklist') fields = `<label class="field"><span>Milestones — one per line</span><textarea class="inp" data-g-ms></textarea></label>`;
      if (gType === 'consistency') fields = hs.length ? `<div class="eyebrow" style="margin:4px 0 8px">Measured by this habit's 30-day rate</div>
          <div class="chips" style="margin-bottom:14px">${hs.map(h => `<button class="chip ${h.id === gHabit ? 'on' : ''}" data-act="g-habit" data-id="${esc(h.id)}">${esc(h.icon || '')} ${esc(h.name)}</button>`).join('')}</div>`
        : `<p class="sub">Add a habit first — a consistency goal tracks one.</p>`;
      if (gType === 'manual') fields = `<p class="sub" style="line-height:1.5;margin:0 0 14px">You move it yourself, 0–100%, from the Goals list.</p>`;
      return `<label class="field"><span>Goal</span><input class="inp" data-g-title maxlength="120" placeholder="e.g. Bench 100 kg" autocomplete="off"></label>
        <div class="eyebrow" style="margin:4px 0 8px">Category</div>
        <div class="chips">${goalCats().map(c => `<button class="chip ${c[0] === gCat ? 'on' : ''}" style="--accent:${pillarColor(c[0])}" data-act="g-cat" data-k="${c[0]}">${esc(c[1])}</button>`).join('')}</div>
        <div class="eyebrow" style="margin:16px 0 8px">Measured by</div>
        <div class="chips" style="margin-bottom:14px">${goalTypes().map(t => `<button class="chip ${t[0] === gType ? 'on' : ''}" data-act="g-type" data-k="${t[0]}">${esc(t[1])}</button>`).join('')}</div>
        ${fields}
        <label class="field"><span>Due (optional)</span><input class="inp" data-g-due type="date" min="${today()}"></label>
        <button class="btn btn-prominent block" style="--accent:#bf5af2" data-act="g-save">Add goal</button>`;
    },
  });
  setTimeout(() => document.querySelector('[data-g-title]')?.focus(), 450);
}
/** Keep what was typed when a chip redraws the goal sheet. */
function keepGoalDraft(fn) {
  const keep = ['data-g-title', 'data-g-cur', 'data-g-tgt', 'data-g-unit', 'data-g-ms', 'data-g-due'].map(a => [a, document.querySelector('[' + a + ']')?.value]);
  fn(); topSheet()?.refresh();
  keep.forEach(([a, v]) => { const el = document.querySelector('[' + a + ']'); if (el && v != null) el.value = v; });
}
function keepDraft(attrs, fn) {
  const keep = attrs.map(a => [a, document.querySelector('[' + a + ']')?.value]);
  fn(); topSheet()?.refresh();
  keep.forEach(([a, v]) => { const el = document.querySelector('[' + a + ']'); if (el && v != null) el.value = v; });
}

/* ══════════════ Apple Health ══════════════ */
/* The health link: one address with a write-only key, so an app or Shortcut needs nothing else. */
let healthKey = null;
async function loadHealthKey() {
  if (healthKey) return healthKey;
  try {
    const r = await fetch(hubBase() + '/api/health/key', { headers: { authorization: 'Bearer ' + state.token }, cache: 'no-store' });
    const j = await r.json(); if (j && j.key) healthKey = j.key;
  } catch (e) { /* offline */ }
  return healthKey;
}
const healthUrl = () => hubBase() + '/api/health' + (healthKey ? '?key=' + healthKey : '');
let hTab = 'link';
export function healthSheet() {
  hTab = 'link';
  const sheet = openSheet({
    id: 'health', title: 'Apple Health',
    render: () => {
      const h = view().health, v = view(), t = today(), b = v.bio[t] || {};
      const got = ['sleep', 'rhr', 'hrv', 'steps', 'active', 'daylight', 'vo2', 'bed', 'wake'].filter(k => b[k] != null);
      const url = healthUrl(), http = /^http:/.test(url);
      const status = h ? `<section class="card frost tight hl-status ok"><span class="ic-dot" style="--c:#30d158">${icon('tick', 16, 2.6)}</span>
          <div><b>Connected · last upload ${esc(ago(Date.parse(h.ts)))}</b><div class="sub">${h.days && h.days > 1 ? h.days + ' days · ' : ''}${Object.keys(h.fields || {}).length} values for ${esc(fmtDay(h.day, { weekday: 'short', day: 'numeric', month: 'short' }))}${got.length ? ' · today: ' + got.length + ' fields' : ''}</div></div></section>`
        : `<section class="card frost tight hl-status"><span class="ic-dot" style="--c:#ff9f0a">${icon('heart', 16)}</span><div><b>Not connected yet</b><div class="sub">Nothing has arrived from Apple Health.</div></div></section>`;
      const link = `<label class="field"><span>Your ARK health link</span><div class="copy-row"><input class="inp" readonly value="${esc(healthKey ? url : 'loading…')}"><button class="circle btn-glass" data-act="copy" data-what="health" aria-label="Copy the link">${icon('copy', 17)}</button></div></label>
        <p class="sub" style="line-height:1.5;margin:-6px 0 12px">The key in it can only add health data — nothing else. ${http ? 'It works while the phone is on your home Wi-Fi; uploads made elsewhere are retried when you are home.' : ''}</p>`;
      const tabs = `<div class="seg" style="margin:14px 0 12px">${[['link', 'Anywhere'], ['app', 'App (home Wi-Fi)'], ['shortcut', 'Shortcut (Wi-Fi)']].map(([k, l]) => `<button class="${hTab === k ? 'on' : ''}" data-act="hl-tab" data-v="${k}">${l}</button>`).join('')}</div>`;
      const app = `<p class="sub" style="line-height:1.55;margin:0 0 10px">The easiest way: the <b>Health Auto Export</b> app reads Apple Health and sends it to ARK by itself, every hour — no Shortcut to build. Its automations are part of the paid version.</p>
        <ol class="steps">
          <li><span>Install <b>Health Auto Export – JSON+CSV</b> from the App Store and allow it to read Health.</span></li>
          <li><span>Open <b>Automations</b> → <b>+</b> → <b>REST API</b>.</span></li>
          <li><span>Paste your <b>ARK health link</b> (above) as the URL. Format <b>JSON</b>, Aggregation <b>Day</b>, date range <b>Since last sync</b>.</span></li>
          <li><span>Pick the metrics: Step Count, Active Energy, Apple Exercise Time, Time in Daylight, Resting Heart Rate, Heart Rate Variability, VO2 Max, Respiratory Rate, Sleep Analysis, Mindful Minutes, Body Mass, Dietary Energy.</span></li>
          <li><span>Turn the automation on, sync <b>every hour</b>, then tap <b>Manual Export</b> once to test — this screen then shows "Connected".</span></li>
        </ol>`;
      const sc = `<p class="sub" style="line-height:1.55;margin:0 0 10px">Free, built once in the Shortcuts app. Runs each morning.</p>
        <ol class="steps">
          <li><span>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> 09:00, Daily → <b>Run Immediately</b> → <b>New Blank Automation</b>.</span></li>
          <li><span>Add <b>Find Health Samples</b>: <i>Steps</i>, Start Date <i>is today</i> — then <b>Calculate Statistics</b> → <b>Sum</b>.</span></li>
          <li><span>Add <b>Find Health Samples</b>: <i>Sleep Analysis</i>, Start Date <i>in the last 1 day</i> — then <b>Calculate Statistics</b> → <b>Sum</b> of Duration (in hours).</span></li>
          <li><span>Optional, the same way: <i>Resting Heart Rate</i> and <i>Heart Rate Variability</i> (sorted latest first, limit 1).</span></li>
          <li><span>Add <b>Get Contents of URL</b>: paste your <b>ARK health link</b>, Method <b>POST</b>, Request Body <b>JSON</b> with keys <code>steps</code>, <code>sleep</code>, <code>restingHR</code>, <code>hrv</code> set to those results. No header needed.</span></li>
        </ol>
        <p class="sub" style="line-height:1.5">Other fields ARK reads: activeEnergy, exerciseMinutes, daylightMinutes, vo2max, bedtime, wakeTime, mindfulMinutes, remSleepMinutes, weight.</p>`;
      const anywhere = `<p class="sub" style="line-height:1.55;margin:0 0 10px">Free, built once in the Shortcuts app. Every morning it reads last night's sleep, HRV, resting heart rate and weight, plus yesterday's steps, and hands them to ARK — which syncs them through GitHub. <b>Works anywhere, PC on or off.</b></p>
        <ol class="steps">
          <li><span>Once: scan your PC's QR with the iPhone <b>Camera</b> so ARK in <b>Safari</b> is connected too (the Shortcut opens Safari for a moment).</span></li>
          <li><span>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Time of Day</b> 07:30 · Daily → <b>Run Immediately</b> → New Blank Automation.</span></li>
          <li><span><b>Find Health Samples</b>: Sleep Analysis · Start Date <i>is in the last 12 hours</i> · Value <i>is Asleep</i> (Core, Deep and REM count) → <b>Get Details of Health Samples</b>: Duration → <b>Calculate Statistics</b>: Sum.</span></li>
          <li><span><b>Find Health Samples</b>: Heart Rate Variability · sort by Start Date, Latest First · Limit 1. The same for <i>Resting Heart Rate</i> and <i>Weight</i>.</span></li>
          <li><span><b>Find Health Samples</b>: Steps · Start Date <i>is yesterday</i> → <b>Calculate Statistics</b>: Sum.</span></li>
          <li><span><b>Dictionary</b> with keys <code>sleep</code>, <code>hrv</code>, <code>restingHR</code>, <code>weight</code> set to those results, and a key <code>yesterday</code> holding a Dictionary with <code>steps</code>.</span></li>
          <li><span><b>URL Encode</b> the Dictionary → <b>Text</b>: <code>https://blackcodie.github.io/ark/#health=</code> followed by the URL Encoded Text → <b>Open URLs</b>.</span></li>
        </ol>
        <div class="copy-row" style="margin:4px 0 10px"><input class="inp" readonly value="https://blackcodie.github.io/ark/#health="><button class="circle btn-glass" data-act="copy-health-prefix" aria-label="Copy">${icon('copy', 17)}</button></div>
        <p class="sub" style="line-height:1.5">Units can be hours, minutes or seconds — ARK works it out. Any value the Shortcut cannot find is simply left out; nothing is guessed. Also read if you add them: <code>deepSleepMinutes</code>, <code>remSleepMinutes</code>, <code>bedtime</code>, <code>wakeTime</code>, <code>vo2max</code>, and in <code>yesterday</code>: <code>activeEnergy</code>, <code>exerciseMinutes</code>, <code>daylightMinutes</code>.</p>`;
      return status + tabs + (hTab === 'link' ? anywhere : link + (hTab === 'app' ? app : sc)) + `<div class="grp-h">What ARK does with it</div>
        <p class="sub" style="line-height:1.55;margin:0">Sleep, HRV, resting heart rate and bed/wake times feed readiness, the mind model and the hormone estimate — including the hour-by-hour curves. Steps, VO₂max and daylight feed inflammation, the body clock and fitness. Values that look wrong are skipped, never guessed.</p>`;
    },
  });
  loadHealthKey().then(() => { if (topSheet() === sheet) sheet.refresh(); });
}

/* ══════════════ Siri & Apple Watch ══════════════ */
// Shortcuts run by voice, from the Apple Watch, the Action button or a widget.
// Each one posts to /api/quick; your PC applies it like anything else logged
// here. Nothing leaves your own devices.
const RECIPES = [
  ['heart', '#ff375f', 'Save workouts to Apple Health', 'A shortcut named “ARK Workout” — Train › Finish runs it',
    ['New shortcut, name it exactly <b>ARK Workout</b>; in its details turn on <b>Receive input: Text</b>', '<b>Get Dictionary from Input</b>',
      '<b>Log Workout</b> — type Traditional Strength Training; Start Date = Dictionary value <code>start</code>; Duration = value <code>minutes</code> minutes',
      'Optional: <b>Show Notification</b> “Workout saved to Health”', 'After a workout: Finish → <b>Save to Apple Health</b>. The data comes from ARK, the shortcut writes it — web apps cannot write to Health themselves']],
  ['scale', '#40c8e0', 'Weigh-in by voice', '“Hey Siri, weigh-in”', ['Ask for Input — Number, prompt “Weight?”', 'Get Contents of URL with the body below']],
  ['check', '#30d158', 'Tick a habit', 'Pick from today’s list — on the Watch too',
    ['Get Contents of URL: the list address below, Method GET, same Authorization header', 'Get Dictionary Value “names” → Choose from List', 'Get Contents of URL with the body below — habit = Chosen Item']],
  ['drop', '#40c8e0', 'Glass of water', 'One tap adds 0.25 L', ['Get Contents of URL with the body below']],
  ['timer', '#30d158', 'Practice minutes', '“Hey Siri, log practice”', ['Ask for Input — Number, prompt “Minutes?”', 'Get Contents of URL with the body below — skill = the skill’s name']],
  ['note', '#ffb340', 'Journal note', 'Dictate a line into your Journal', ['Dictate Text', 'Get Contents of URL with the body below — text = Dictated Text']],
];
const BODIES = [
  { name: 'Push A', start: '2026-09-27T17:05:00.000Z', end: '2026-09-27T18:10:00.000Z', minutes: 65, sets: 18 },
  { action: 'weight', weight: 83.4, unit: 'kg' },
  { action: 'habit', habit: 'Read 30+ minutes' },
  { action: 'water', amount: 0.25 },
  { action: 'practice', skill: 'Guitar', mins: 20 },
  { action: 'note', text: 'Felt strong today', cat: 'log' },
];
let rOpen = -1;
export function siriSheet() {
  rOpen = -1;
  openSheet({
    id: 'siri', title: 'Siri & Apple Watch',
    render: () => {
      const url = hubBase() + '/api/quick', list = hubBase() + '/api/list/habits';
      return `<p class="sub" style="line-height:1.55;margin:0 0 14px;font-size:.9rem">Build these once in the Shortcuts app. They then run by voice (“Hey Siri, weigh-in”), from the Apple Watch (turn on <b>Show on Apple Watch</b> in each shortcut's details), the Action button or a Home Screen widget. Your PC applies each one like anything logged here, and Siri says what was logged.</p>
        <section class="list frost">${RECIPES.map((r, i) => `<button class="li" data-act="siri-open" data-i="${i}" style="--c:${r[1]}"><span class="ic">${icon(r[0], 17)}</span>
          <span class="tx"><div class="tt">${r[2]}</div><div class="st">${r[3]}</div></span><span class="chev">${icon(rOpen === i ? 'down' : 'chev', 16)}</span></button>
          ${rOpen === i ? `<div class="recipe"><ol class="steps">${r[4].map(x => `<li><span>${x}</span></li>`).join('')}</ol>
            <pre class="code-blk">${esc(JSON.stringify(BODIES[i], null, 1))}</pre></div>` : ''}`).join('')}</section>
        <div class="grp-h">For every shortcut</div>
        <p class="sub" style="line-height:1.5;margin:0 0 10px">“Get Contents of URL” — Method <b>POST</b>, Header <b>Authorization</b> = the key below, Request Body <b>JSON</b>. Add <b>Show Result</b> → <i>say</i> if you want Siri to answer.</p>
        <label class="field"><span>Address</span><div class="copy-row"><input class="inp" readonly value="${esc(url)}"><button class="circle btn-glass" data-act="copy" data-what="quick" aria-label="Copy address">${icon('copy', 17)}</button></div></label>
        <label class="field"><span>Habit list (GET)</span><div class="copy-row"><input class="inp" readonly value="${esc(list)}"><button class="circle btn-glass" data-act="copy" data-what="list" aria-label="Copy habit list address">${icon('copy', 17)}</button></div></label>
        <label class="field"><span>Authorization header</span><div class="copy-row"><input class="inp" readonly value="Bearer ••••••••••••" aria-label="Authorization key, hidden"><button class="circle btn-glass" data-act="copy" data-what="token" aria-label="Copy authorization key">${icon('copy', 17)}</button></div></label>
        <p class="sub" style="line-height:1.5">Also accepted: <code>vitals</code> with any of sleep, energy, mood, stress, rhr, hrv, steps; <code>protein</code> with amount in grams. Add an <code>id</code> field to make a retried shortcut count once.</p>
        ${/^http:/.test(url) ? `<p class="sub" style="line-height:1.5">This address works on home Wi-Fi. With Tailscale on the phone and the Watch paired to it, the https address from 📱 Phone works everywhere.</p>` : ''}`;
    },
  });
}

/* ══════════════ notifications ══════════════ */
const PUSH_DEFAULTS = { habits: true, habitsAt: '20:30', vitals: true, vitalsAt: '10:00', weigh: 'off', weighAt: '08:00', rest: true, review: true, reviewAt: '19:00' };
const pushPrefs = () => ({ ...PUSH_DEFAULTS, ...((view().push || {}).prefs || {}) });
const standalone = () => navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
function pushBlocker() {
  if (!window.isSecureContext) return 'iPhone only lets a web app send notifications when it is opened from a secure (https) address. Open ARK from the Tailscale address shown in 📱 Phone on your PC, then add it to the Home Screen.';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return standalone() ? 'This version of iOS cannot deliver web notifications — iOS 16.4 or later is needed.'
      : 'Add ARK to your Home Screen first (Share → Add to Home Screen) and open it from there — iPhone only allows notifications for Home Screen apps.';
  }
  return '';
}
export function notifySheet() {
  openSheet({
    id: 'notify', title: 'Notifications',
    render: () => {
      const block = pushBlocker(), on = state.push.on && !block, p = pushPrefs(), key = (view().push || {}).key;
      const times = (k, opts) => `<div class="chips" style="margin-top:8px">${opts.map(o => `<button class="chip num ${p[k] === o ? 'on' : ''}" data-act="np" data-k="${k}" data-v="${o}">${o}</button>`).join('')}</div>`;
      const tg = (k, title, sub) => `<button class="tg-row" data-act="np" data-k="${k}" data-v="${p[k] ? '0' : '1'}" role="switch" aria-checked="${!!p[k]}">
          <span class="tx"><b>${title}</b><small>${sub}</small></span><i class="tg${p[k] ? ' on' : ''}"></i></button>`;
      let H = `<p class="sub" style="line-height:1.55;margin:0 0 14px;font-size:.9rem">Your PC sends these itself — encrypted for this phone, delivered by Apple, no ARK server in between. They arrive whenever the PC is on, even with ARK closed to the tray.</p>`;
      if (block) return H + `<section class="card frost"><p style="margin:0;line-height:1.5">${esc(block)}</p></section>`;
      if (!on) return H + (key
        ? `<button class="btn btn-prominent block" data-act="push-on">${icon('bell', 18)} Turn on notifications</button>`
        : `<section class="card frost"><p style="margin:0;line-height:1.5">Waiting for your PC's notification key — it arrives with the next sync. Make sure ARK on the PC is up to date.</p></section>`);
      H += `<section class="card frost" style="padding:4px 16px;margin-bottom:10px">
          ${tg('quests', 'Quests left', 'One nudge with what is still open — protein, weigh-in, the workout')}${p.quests ? times('questsAt', ['12:00', '18:00', '20:00']) + '<div style="height:10px"></div>' : ''}
        </section>
        <section class="card frost" style="padding:4px 16px">
          ${tg('habits', 'Habits left', 'One nudge if anything is still open')}${p.habits ? times('habitsAt', ['19:00', '20:30', '21:30']) + '<div style="height:10px"></div>' : ''}
        </section>
        <section class="card frost" style="padding:4px 16px;margin-top:10px">
          ${tg('vitals', 'Log last night', 'Only if sleep is not in yet — Apple Health imports count')}${p.vitals ? times('vitalsAt', ['08:00', '10:00', '12:00']) + '<div style="height:10px"></div>' : ''}
        </section>
        <section class="card frost" style="margin-top:10px"><div class="row"><span class="tx" style="flex:1"><b>Weigh-in reminder</b><div class="sub">Only if you have not weighed in that day</div></span></div>
          <div class="seg" style="margin-top:10px">${[['off', 'Off'], ['daily', 'Daily'], ['mon', 'Mondays']].map(o => `<button class="${p.weigh === o[0] ? 'on' : ''}" data-act="np" data-k="weigh" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>
          ${p.weigh !== 'off' ? times('weighAt', ['07:00', '08:00', '09:00']) : ''}</section>
        <section class="card frost" style="padding:4px 16px;margin-top:10px">${tg('rest', 'Rest timer', 'When the screen is off during a workout')}</section>
        <section class="card frost" style="padding:4px 16px;margin-top:10px">
          ${tg('review', 'Weekly review', 'Sunday evening: your week in one line')}${p.review ? times('reviewAt', ['18:00', '19:00', '20:00']) + '<div style="height:10px"></div>' : ''}
        </section>
        <button class="btn btn-glass block" style="margin-top:16px" data-act="push-off">Turn off on this phone</button>
        <p class="sub" style="text-align:center;margin-top:12px">Changes reach your PC with the next sync.</p>`;
      return H;
    },
  });
}
async function pushOn() {
  const key = (view().push || {}).key;
  if (!key) { toast('Waiting for your PC — sync first'); return; }
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Notifications are blocked — allow them in iOS Settings → Notifications → ARK'); return; }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    // A subscription made for an older PC key (after a reset) cannot be used.
    if (sub) {
      const k = sub.options && sub.options.applicationServerKey;
      if (k && L.b64u(new Uint8Array(k)) !== key) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: L.unb64u(key) });
    const j = sub.toJSON();
    state.push = { on: true, endpoint: j.endpoint };
    emit('push.sub', { sub: { endpoint: j.endpoint, keys: j.keys }, origin: location.origin });
    haptic(); toast('🔔 Notifications on');
  } catch (e) {
    toast('Could not turn on notifications — ' + (e && e.message || e));
  }
}
async function pushOff() {
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* already gone */ }
  emit('push.unsub', { endpoint: state.push.endpoint });
  state.push = { on: false, endpoint: null };
  changed({ now: true }); toast('Notifications off');
}

/* ── the rest timer while the screen is off ── */
// iOS freezes a backgrounded page, so the timer's chime cannot play. The PC
// schedules one push for the moment rest ends; coming back cancels it.
export function onHidden() {
  const W = state.workout;
  if (!W || W.edit || !state.push.on || !(W.restEnd > Date.now() + 4000) || pushPrefs().rest === false || state.settings.restClock) return;
  W.restPushed = W.restEnd;
  emit('push.timer', { at: W.restEnd, title: 'Rest over', body: nextSetHint() });
  syncNow({ keepalive: true });
}
export function onVisible() {
  const W = state.workout;
  if (!W || !W.restPushed) return;
  const pending = W.restPushed > Date.now();
  delete W.restPushed;
  if (pending) emit('push.cancel', {}); else changed({ silent: true });
}

/* ══════════════ appearance ══════════════ */
export function appearanceChips() {
  const t = state.settings.theme || 'dark';
  return `<div class="seg">${[['dark', 'Dark'], ['light', 'Light'], ['system', 'Match iPhone']].map(o =>
    `<button class="${t === o[0] ? 'on' : ''}" data-act="theme" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>`;
}

/* ══════════════ fixing past entries ══════════════ */
/** Remove a queued-but-unsent creation outright; otherwise send the delete. */
function undoOrDelete(match, type, data, msg) {
  const ev = state.pending.find(e => !e.seq && match(e));
  if (ev) { dropPending(ev.id); haptic(); toast(msg); return; }
  emitUndoable(type, data, msg);
}
export function weighList() {
  const W = view().weights, ks = Object.keys(W).sort().reverse().slice(0, 8);
  if (!ks.length) return '';
  return `<div class="grp-h">Recent weigh-ins</div><section class="list frost">${ks.map(k => `<div class="li" style="--c:#40c8e0">
    <span class="tx"><div class="tt num">${fmt1(W[k])} kg</div><div class="st">${fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' })}</div></span>
    <button class="circle sm" data-act="w-del" data-day="${k}" aria-label="Delete the ${fmtDay(k)} weigh-in">${icon('trash', 16)}</button></div>`).join('')}</section>`;
}
export function practiceList(skillId) {
  const sk = view().skills.find(s => s.id === skillId);
  if (!sk || !sk.recent.length) return '';
  return `<div class="grp-h">Recent sessions · ${esc(sk.name)}</div><section class="list frost">${sk.recent.map(r => {
    const d = new Date(r.date), when = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<div class="li" style="--c:#30d158"><span class="tx"><div class="tt">${fmtMins(r.mins)}</div><div class="st">${esc(when)}${r.note ? ' · ' + esc(r.note) : ''}</div></span>
      <button class="circle sm" data-act="pr-del" data-skill="${esc(sk.id)}" data-date="${esc(r.date)}" aria-label="Delete the ${esc(when)} session">${icon('trash', 16)}</button></div>`;
  }).join('')}</section>`;
}

export const actions = {
  /* create */
  'habit-new'() { habitNewSheet(); },
  'h-icon'(d) { keepDraft(H_KEEP, () => { hIcon = d.i; }); },
  'h-color'(d) { keepDraft(H_KEEP, () => { hColor = d.c; }); },
  'h-pillar'(d) { keepDraft(['data-h-name'], () => { hPillar = d.k; }); },
  'h-eff'(d) {
    keepDraft(['data-h-name'], () => {
      hEff = d.k;
      const def = L.EFFECT_CHOICES.find(c => c[0] === d.k);
      if (hEff !== 'none') hMin = def ? def[2] : 10;
    });
  },
  'h-min'(d) {
    // One-minute steps up to 5 (cold is counted in single minutes), five-minute steps above.
    keepDraft(['data-h-name'], () => { const dir = Math.sign(Number(d.d)), st = hMin < 5 || (hMin === 5 && dir < 0) ? 1 : 5; hMin = Math.max(1, Math.min(120, hMin + dir * st)); });
  },
  'h-save'() {
    const name = val('[data-h-name]');
    if (!name) { toast('Name the habit'); return; }
    if (view().habits.some(h => h.name.toLowerCase() === name.toLowerCase())) { toast('You already have that habit'); return; }
    const id = 'hc-' + Date.now();
    emit('habit.add', { habit: { id, name, icon: hIcon, pillar: hPillar } });
    const eff = effectOf(); if (eff) emit('habit.edit', { id, effect: eff });
    closeSheet(topSheet()); haptic(); toast(hIcon + ' ' + name + ' added');
  },
  'habit-edit'(d) { haptic(); habitEditSheet(d.id); },
  'h-edit-save'() {
    const h = view().habits.find(x => x.id === editId); if (!h) return;
    const name = val('[data-h-name]');
    if (!name) { toast('Name the habit'); return; }
    if (view().habits.some(x => x.id !== h.id && x.name.toLowerCase() === name.toLowerCase())) { toast('Another habit has that name'); return; }
    const patch = { id: h.id };
    if (name !== h.name) patch.name = name;
    if (hIcon !== h.icon) patch.icon = hIcon;
    if (hPillar !== (h.pillar || 'custom')) patch.pillar = hPillar;
    const eff = effectOf(), cur = L.habitEffect(h);
    if (JSON.stringify(eff) !== JSON.stringify(cur)) patch.effect = eff;
    // colour, unit and the amount slider's range (logic/habitlog.ts cleanHabitMeta checks them on the PC too)
    if (hColor && hColor !== h.color) patch.color = hColor;
    const unit = (val('[data-h-unit]') || '').trim(), n = q => { const x = parseFloat(String(val(q) || '').replace(',', '.')); return isFinite(x) ? x : null; };
    if (unit !== (h.unit || '')) patch.unit = unit;
    const lo = n('[data-h-amin]'), hi = n('[data-h-amax]'), st = n('[data-h-astep]');
    if (unit && (lo != null || hi != null)) {
      const L0 = lo != null ? lo : 0, H0 = hi != null ? hi : 10;
      if (!(H0 > L0)) { toast('“To” must be more than “From”'); return; }
      if (L0 !== h.amin || H0 !== h.amax) { patch.amin = L0; patch.amax = H0; }
    }
    if (st != null && st > 0 && st !== h.astep) patch.astep = st;
    closeSheet(topSheet());
    if (Object.keys(patch).length > 1) { emit('habit.edit', patch); haptic(); toast('Saved · ' + hIcon + ' ' + name); }
  },
  'habit-hide'(d) {
    const h = view().habits.find(x => x.id === d.id); if (!h) return;
    if (topSheet() && topSheet().id === 'habit-edit') closeSheet(topSheet());
    haptic(); emit('habit.hide', { id: h.id, hidden: true });
    toast(h.name + ' hidden', 'Undo', () => emit('habit.hide', { id: h.id, hidden: false }));
  },
  'habit-unhide'(d) { haptic(); emit('habit.hide', { id: d.id, hidden: false }); },
  'h-del'(d) {
    const h = view().habits.find(x => x.id === d.id); if (!h || !isCustomHabit(h)) return;
    if (topSheet() && topSheet().id === 'habit-edit') closeSheet(topSheet());
    undoOrDelete(e => e.type === 'habit.add' && e.data.habit && e.data.habit.id === d.id, 'habit.del', { id: d.id }, h.name + ' removed');
  },
  'skill-new'() { skillNewSheet(); },
  'k-cat'(d) { keepDraft(['data-k-name', 'data-k-ms', 'data-k-why'], () => { kCat = d.k; }); },
  'k-level'(d) { keepDraft(['data-k-name', 'data-k-ms', 'data-k-why'], () => { kLevel = Number(d.v); if (kTarget < kLevel) kTarget = kLevel; }); },
  'k-target'(d) { keepDraft(['data-k-name', 'data-k-ms', 'data-k-why'], () => { kTarget = Number(d.v); }); },
  'k-save'() {
    const name = val('[data-k-name]');
    if (!name) { toast('Name the skill'); return; }
    emit('skill.add', { skill: { id: 'cs' + Date.now(), name, cat: kCat, level: kLevel, target: Math.max(kLevel, kTarget),
      milestones: lines(val('[data-k-ms]')).map(t => ({ t })), why: val('[data-k-why]') } });
    closeSheet(topSheet()); haptic(); toast('Skill added · ' + name);
  },
  'goal-new'() { goalNewSheet(); },
  'g-cat'(d) { keepGoalDraft(() => { gCat = d.k; }); },
  'g-type'(d) { keepGoalDraft(() => { gType = d.k; }); },
  'g-habit'(d) { keepGoalDraft(() => { gHabit = d.id; }); },
  'g-save'() {
    const title = val('[data-g-title]');
    if (!title) { toast('Name the goal'); return; }
    const g = { id: 'g' + Date.now(), title, cat: gCat, type: gType, due: val('[data-g-due]') };
    if (gType === 'numeric') {
      const tgt = parseFloat(val('[data-g-tgt]').replace(',', '.')), cur = parseFloat(val('[data-g-cur]').replace(',', '.'));
      if (!(tgt > 0)) { toast('Set a target number'); return; }
      Object.assign(g, { target: tgt, current: cur >= 0 ? cur : 0, unit: val('[data-g-unit]') });
    }
    if (gType === 'checklist') { g.milestones = lines(val('[data-g-ms]')).map(t => ({ t, done: false })); if (!g.milestones.length) { toast('Add at least one milestone'); return; } }
    if (gType === 'consistency') { if (!gHabit) { toast('Pick the habit it tracks'); return; } g.habit = gHabit; }
    if (gType === 'manual') g.current = 0;
    emit('goal.add', { goal: g });
    state.growSeg = 'goals';
    closeSheet(topSheet()); haptic(); toast('Goal added · ' + title);
  },
  /* fix */
  'w-del'(d) {
    undoOrDelete(e => e.type === 'weight.set' && e.data.day === d.day, 'weight.del', { day: d.day }, 'Weigh-in removed');
  },
  'pr-del'(d) {
    undoOrDelete(e => e.type === 'skill.practice' && e.data.skill === d.skill && e.data.date === d.date, 'practice.del', { skill: d.skill, date: d.date }, 'Practice session removed');
  },
  'note-del'(d) {
    // The PC's ids are numbers; dataset gives strings — send the entry's own id back.
    const j = (view().journal || []).find(x => (d.id !== '' && String(x.id) === d.id) || (d.sid && x.sid === d.sid));
    if (!j || !confirm('Delete this note?')) return;
    undoOrDelete(e => e.type === 'note.add' && e.id === j.sid, 'note.del', { id: j.id != null ? j.id : j.sid }, 'Note deleted');
  },
  /* health, notifications, appearance */
  'health-sheet'() { healthSheet(); },
  'siri-sheet'() { siriSheet(); },
  'siri-open'(d) { rOpen = rOpen === Number(d.i) ? -1 : Number(d.i); topSheet()?.refresh(); },
  async copy(d) {
    const text = d.what === 'token' ? 'Bearer ' + state.token : d.what === 'quick' ? hubBase() + '/api/quick'
      : d.what === 'list' ? hubBase() + '/api/list/habits' : d.what === 'health' ? (await loadHealthKey(), healthUrl()) : hubBase() + '/api/health';
    toast(await copyText(text) ? 'Copied' : 'Could not copy — press and hold the field instead');
  },
  'hl-tab'(d) { hTab = d.v; haptic(); topSheet()?.refresh(); },
  'copy-health-prefix'() { navigator.clipboard?.writeText('https://blackcodie.github.io/ark/#health=').then(() => toast('Copied'), () => toast('Select and copy it')); },
  'notify-sheet'() { notifySheet(); },
  'push-on'() { pushOn().then(() => topSheet()?.refresh()); },
  'push-off'() { pushOff().then(() => topSheet()?.refresh()); },
  np(d) {
    const v = ['habits', 'vitals', 'rest', 'review'].includes(d.k) ? d.v === '1' : d.v;
    haptic(); emit('push.prefs', { prefs: { [d.k]: v } });
  },
  theme(d) { state.settings.theme = d.v; applyTheme(); changed({ now: true }); },
};
