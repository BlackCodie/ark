/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Today, Habits, Body, Grow.
   Every number here is read from view() — the desktop's snapshot plus the
   changes queued on this phone. Nothing is estimated on the phone; where the
   desktop computes something (readiness), the phone shows the desktop's value
   and says when it is waiting for a fresh one.
   ══════════════════════════════════════════════════════════════════════ */
import { questsCard, renderLab } from './system.js';
import { fuelCard } from './daily.js';
import {
  L, state, view, emit, changed, esc, icon, today, shiftDay, fmt1, fmtMins, fmtDay, daysBetween, homeMove, anywhere, caState, checkCa, onPublicCopy, pair,
  ringsSvg, ringSvg, sparkSvg, barsSvg, syncLabel, paired, haptic, toast, scheduleSync,
} from './core.js';
import { staleNote } from './more.js';
import { routineCard, renderBooks } from './routines.js';
import { mindGlance } from './mind.js';

export const PILLAR = {
  body: ['Body', '#30d158'], mind: ['Mind', '#7d7aff'], income: ['Income', '#ff9f0a'],
  survival: ['Survival', '#ff6b5a'], modern: ['Modern', '#40c8e0'], life: ['Life', '#bf5af2'], custom: ['Custom', '#bf5af2'],
};
export const pillarColor = (p, v = view()) => (v.colors && v.colors[p]) || (PILLAR[p] || PILLAR.custom)[1];
export const GROUPS = {
  chest: ['Chest', '#ff7a7a'], back: ['Back', '#8b8cff'], shoulders: ['Shoulders', '#40c8e0'],
  arms: ['Arms', '#ffb340'], legs: ['Legs', '#30d158'], core: ['Core', '#bf5af2'],
};
export const MOODS = [['💀', 'Destroyed'], ['😮‍💨', 'Drained'], ['😐', 'Stable'], ['😤', 'Sharp'], ['🔥', 'Locked in'], ['⚡', 'Ascended']];
const RECOVERY = {
  fresh: ['Recovering', '#ffb340'], recovering: ['Recovering', '#ffb340'], ready: ['Ready', '#30d158'],
  detrained: ['Fading', '#ff6b5a'], untouched: ['Untrained', 'rgba(235,240,245,.4)'],
};

const C = { habits: '#30d158', train: '#ff9f0a', practice: '#40c8e0', goal: '#bf5af2', vitals: '#7d7aff' };

/* ── shared reads ── */
export function weekStart(k) {
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d), dow = (dt.getDay() + 6) % 7;
  return L.dayKey(new Date(y, m - 1, d - dow));
}
export function doneOn(v, day) { return v.habits.filter(h => v.habitLog[day] && v.habitLog[day][h.id]).length; }
export function practiceMinsOn(v, day) {
  let m = 0;
  v.skills.forEach(s => s.recent.forEach(r => { if (L.dayKey(new Date(r.date)) === day) m += r.mins; }));
  return m;
}
/** Group-level recovery from the desktop's per-muscle body state. */
export function groupStates(v) {
  const out = {};
  Object.keys(GROUPS).forEach(g => {
    const ms = v.body.muscles.filter(m => m.group === g);
    const trained = ms.filter(m => m.hoursSince !== null).sort((a, b) => a.hoursSince - b.hoursSince);
    const lead = trained[0] || ms[0];
    out[g] = { state: lead ? (trained[0] ? lead.state : 'untouched') : 'untouched', hours: trained[0] ? trained[0].hoursSince : null,
      priority: Math.max(0, ...ms.map(m => m.priority || 0)) };
  });
  return out;
}
/** The desktop's TRAIN NEXT ranking, rolled up to groups (same as the desktop does). */
export function trainNext(v) {
  const seen = [], ranked = v.body.muscles.slice().sort((a, b) => b.priority - a.priority);
  // an injury logged on this phone counts at once, before the PC has re-ranked
  const inj = L.activeInjuries(v.injuries || [], today());
  for (const m of ranked) {
    if (!m.group || m.priority <= 0.05 || (inj[m.slug] && inj[m.slug].sev >= 2) || seen.some(s => s.group === m.group)) continue;
    seen.push(m); if (seen.length === 3) break;
  }
  return seen;
}

function hdr(eyebrow, title, acts = '') {
  return `<header class="hdr"><div><div class="hdr-eyebrow">${esc(eyebrow)}</div><h1 class="hdr-title">${esc(title)}</h1></div>
    <div class="hdr-acts">${acts}</div></header>`;
}
export function syncButton() {
  const s = syncLabel();
  return `<button class="circle glass" data-act="sync-sheet" aria-label="Sync: ${esc(s.text)}" style="position:relative">
    ${icon('sync', 20)}<span class="dot-badge ${s.tone}" data-sync-dot></span></button>`;
}
const longDate = () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

/* ══════════════ TODAY ══════════════ */
/* Opened from the PC's QR code: link this phone by itself. On the GitHub copy the first try needs the
   PC's certificate trusted (iPhone's rule for a secure local connection), so until then the screen
   shows that one step and keeps retrying every 3 s — the moment it is trusted, it connects. */
let autoTm = null, autoMsg = '';
function autoConnect() {
  if (autoTm || !state.qrCode || state.token) return;
  const tryOnce = async () => {
    const q = state.qrCode;
    if (!q || state.token) { clearInterval(autoTm); autoTm = null; return; }
    if (Date.now() - q.at > 30 * 60e3) { autoMsg = 'This QR code has expired — scan the new one on your PC.'; state.qrCode = null; clearInterval(autoTm); autoTm = null; changed(); return; }
    const r = await pair(q.code, null);
    if (r.ok) { state.qrCode = null; clearInterval(autoTm); autoTm = null; toast('Connected to ARK ✓'); return; }
    if (!/reach/.test(r.msg || '')) { autoMsg = 'That QR code was already used or expired — scan the new one on your PC.'; state.qrCode = null; clearInterval(autoTm); autoTm = null; }
    else autoMsg = 'waiting';
    changed();
  };
  autoTm = setInterval(tryOnce, 3000); tryOnce();
}
function connectScreen() {
  autoConnect();
  const host = (state.hub || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
  const needCert = onPublicCopy() && autoMsg === 'waiting';
  return hdr('ARK', 'Connecting…', '') + `<section class="card glass" style="margin-top:6px">
    <h2 style="margin:0 0 6px;font-size:1.3rem">${needCert ? 'One step on this iPhone' : 'Linking to your PC…'}</h2>
    ${needCert ? `<p class="muted" style="margin:0 0 12px;line-height:1.5">iPhone only lets an app talk securely to your PC after you trust ARK's certificate — once, ever.</p>
      <ol class="steps">
        <li><span>Tap <b>Install certificate</b> → <b>Allow</b>.</span></li>
        <li><span>Settings app → <b>Profile Downloaded</b> → <b>Install</b>.</span></li>
        <li><span>Settings → General → About → <b>Certificate Trust Settings</b> → turn on <b>ARK local certificate</b>.</span></li>
        <li><span>Come back — ARK connects by itself.</span></li>
      </ol>
      <a class="btn btn-prominent block" style="text-decoration:none" href="http://${esc(host)}:7788/ark-ca.crt">Install certificate</a>`
    : `<p class="muted" style="margin:0;line-height:1.5">${autoMsg && autoMsg !== 'waiting' ? esc(autoMsg) : 'Be on home Wi-Fi with ARK open on the PC.'}</p>`}
  </section>`;
}
function onboarding() {
  if (state.qrCode || (autoMsg && autoMsg !== 'waiting')) return connectScreen();
  return hdr('ARK', 'Welcome', '')
    + `<section class="card glass" style="margin-top:6px">
      <div style="width:56px;height:56px;border-radius:17px;display:grid;place-items:center;margin-bottom:14px;color:#03130d;
        background:linear-gradient(135deg,#5ee6b5,#40c8e0)">${icon('hex', 30, 2.2)}</div>
      <h2 style="margin:0 0 6px;font-size:1.35rem">Connect to ARK on your PC</h2>
      <p class="muted" style="margin:0 0 16px;line-height:1.5;font-size:.95rem">Your data lives on your PC. This app is a
        pocket window into it: log workouts, habits, weigh-ins and practice here, and they land in ARK the next time the two can reach each other — even if you logged offline at the gym.</p>
      <ol class="steps">
        <li><span>On your PC, open ARK and click <b>📱 Phone</b>.</span></li>
        <li><span>${onPublicCopy() ? 'Tap <b>Scan the QR code</b> below and point the camera at it.' : "Scan the QR code with the iPhone camera. That's it."}</span></li>
      </ol>
      ${onPublicCopy() ? `<button class="btn btn-prominent block" data-act="pair-scan">${icon('camera', 17)} Scan the QR code</button>`
        : `<button class="btn btn-glass block" data-act="pair-sheet">Enter a code instead</button>`}
    </section>`;
}

export function renderToday() {
  if (!paired()) return onboarding();
  const v = view(), t = today(), s = state.settings;
  const done = doneOn(v, t), total = v.habits.length;
  const ws = weekStart(t);
  const weekSessions = v.workouts.filter(w => w.date >= ws && w.date <= t).length;
  const todays = v.workouts.filter(w => w.date === t);
  const pm = practiceMinsOn(v, t);
  const gap = L.daysSinceCapture(v, t);

  let H = hdr(longDate(), 'Today', syncButton()) + staleNote();
  const any = mv0();
  if (any) {
    if (caState.trusted === null) { caState.trusted = false; checkCa(); }
    const ok = caState.trusted;
    H += `<section class="welcome frost anywhere"><h3>📲 Open ARK even with the PC off</h3>
      <p>iPhone keeps an offline copy only of secure (https) apps. ARK has one on GitHub that talks to your PC securely — two steps, once.</p>
      <div class="aw-step${ok ? ' done' : ''}"><b>1</b><div><div class="tt">Trust ARK's certificate${ok ? ' — done ✓' : ''}</div>
        ${ok ? '' : `<div class="sub">Tap Download → Allow. Then Settings → <b>Profile Downloaded</b> → Install. Then Settings → General → About → <b>Certificate Trust Settings</b> → turn on "ARK local certificate". Come back here.</div>
        <div class="row" style="gap:8px;margin-top:8px"><a class="btn sm btn-prominent" style="text-decoration:none" href="${esc(any.ca)}">Download certificate</a><button class="btn sm btn-glass" data-act="ca-recheck">Check again</button></div>`}</div></div>
      <div class="aw-step${ok ? '' : ' wait'}"><b>2</b><div><div class="tt">Open the GitHub copy</div>
        <div class="sub">Your pairing comes along — no code. Then Share → Add to Home Screen, and delete the old ARK icon.</div>
        ${ok ? `<a class="btn sm btn-prominent" style="text-decoration:none;margin-top:8px" href="${esc(any.url)}">Open ARK anywhere</a>` : ''}</div></div>
    </section>`;
  }
  const mv = homeMove();
  if (mv) H += `<section class="welcome frost"><h3>📌 One address for good</h3>
    <p>ARK is open at your PC's IP address, which your router can change — and a new address means setting the app up again. <b>${esc(mv.host)}</b> always finds your PC on home Wi-Fi. Your pairing moves with you.</p>
    ${state.pending.length ? '<p class="sub">Waiting for your last changes to sync first…</p>' : `<a class="btn sm btn-prominent" style="text-decoration:none" href="${esc(mv.url)}">Move to ${esc(mv.host)}</a>
    <p class="sub" style="margin-top:8px">Then Share → Add to Home Screen, and delete the old icon.</p>`}</section>`;

  if (gap !== null && gap >= 4) {
    H += `<section class="welcome frost">
      <h3>Welcome back 👋</h3>
      <p>${gap} days since your last entry. Nothing to catch up on — pick one small thing and the rest follows.
      ${(() => { const ds = v.workouts.map(w => w.date).sort(), wg = ds.length ? daysBetween(ds[ds.length - 1], t) : null;
        return wg !== null && wg >= 14 ? (wg === gap ? 'Workout targets start near 85% of last time — strength comes back fast.' : `${wg} days since you trained, so workout targets start near 85% of last time.`) : ''; })()}</p>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn sm btn-prominent" data-act="tab" data-tab="habits">Tick one habit</button>
        <button class="btn sm btn-glass" data-act="weigh-sheet">Weigh in</button>
      </div></section>`;
  } else if (gap === null) {
    H += `<section class="welcome frost"><h3>You're connected</h3>
      <p>Everything you log here lands in ARK on your PC. Start with whatever is easiest today.</p></section>`;
  }

  H += `<section class="card frost rings">
    <div>${ringsSvg([
      { v: total ? done / total : 0, c: C.habits },
      { v: weekSessions / (s.weeklyWorkouts || 3), c: C.train },
      { v: pm / (s.practiceMins || 30), c: C.practice },
    ])}</div>
    <div class="ring-legend">
      <div class="rl" style="--c:${C.habits}"><div class="k">Habits</div><div class="v num">${done}<small>/ ${total}</small></div></div>
      <div class="rl" style="--c:${C.train}"><div class="k">Workouts · week</div><div class="v num">${weekSessions}<small>/ ${s.weeklyWorkouts}</small></div></div>
      <div class="rl" style="--c:${C.practice}"><div class="k">Practice</div><div class="v num">${pm}<small>/ ${s.practiceMins} min</small></div></div>
    </div></section>`;

  H += questsCard(v);
  H += fuelCard(v);
  H += healthCard(v, t);
  H += routineCard();
  H += mindGlance();

  /* up next — one list, each item doable from here */
  const items = [];
  if (state.workout) {
    items.push(state.workout.edit
      ? { ic: 'pencil', c: C.train, t: 'Editing a past workout', st: fmtDay(state.workout.edit.date, { weekday: 'long', day: 'numeric', month: 'short' }) + ' · not saved yet', act: 'open-workout' }
      : { ic: 'dumbbell', c: C.train, t: 'Workout in progress', st: 'Tap to continue', act: 'open-workout' });
  } else if (todays.length) {
    const w = todays[todays.length - 1];
    items.push({ done: true, ic: 'dumbbell', c: C.train, t: 'Workout logged', st: `${w.exercises.length} exercises · ${Math.round(w.volume).toLocaleString()} ${w.unit || 'kg'}` });
  } else {
    const tn = trainNext(v);
    if (tn.length) {
      const names = tn.map(m => GROUPS[m.group][0]).join(' · ');
      const why = tn[0].state === 'detrained' ? 'Adaptation is fading — retrain first'
        : tn[0].state === 'untouched' ? 'Never trained yet' : 'Recovered and under weekly target';
      items.push({ ic: 'dumbbell', c: C.train, t: 'Train ' + names, st: why, act: 'start-suggested' });
    } else if (v.workouts.length) {
      items.push({ ic: 'dumbbell', c: C.train, t: 'Rest day', st: 'Everything is still recovering' });
    } else {
      items.push({ ic: 'dumbbell', c: C.train, t: 'Log your first workout', st: 'Pick exercises as you go', act: 'start-empty' });
    }
  }
  const left = v.habits.filter(h => !(v.habitLog[t] && v.habitLog[t][h.id]));
  if (total) {
    if (left.length) items.push({ ic: 'check', c: C.habits, t: left.length + ' habit' + (left.length === 1 ? '' : 's') + ' left',
      st: left.slice(0, 3).map(h => h.icon + ' ' + h.name).join('  ·  '), act: 'tab', tab: 'habits' });
    else items.push({ done: true, ic: 'check', c: C.habits, t: 'All habits done', st: 'Day complete' });
  }
  if (!v.bio[t] || v.bio[t].sleep == null) items.push({ ic: 'moon', c: C.vitals, t: 'Log sleep & energy', st: 'Ten seconds — it drives your readiness', act: 'vitals-sheet' });
  // Sunday: the week is in.
  if (new Date().getDay() === 0 && (v.workouts.length || Object.keys(v.habitLog).length)) items.push({ ic: 'chart', c: '#bf5af2', t: 'Your week in review', st: 'What you did, next to last week', act: 'review-sheet' });
  const goal = v.goals.filter(g => g.status === 'active').sort((a, b) => (a.priority || 2) - (b.priority || 2) || (a.due || '9').localeCompare(b.due || '9'))[0];
  if (goal) {
    const next = (goal.milestones || []).find(m => !m.done);
    const st = next ? 'Next: ' + next.t : goal.type === 'numeric' ? `${fmt1(goal.current || 0)} / ${fmt1(goal.target || 0)} ${goal.unit || ''}` : Math.round(L.goalProgress(goal, goal.habitRate) * 100) + '% there';
    items.push({ ic: 'target', c: C.goal, t: goal.title, st, act: 'tab', tab: 'grow', seg: 'goals' });
  }
  const sk = v.skills.filter(x => x.status !== 'archived').sort((a, b) => (a.last || '').localeCompare(b.last || ''))[0];
  if (sk) {
    const d = sk.last ? daysBetween(L.dayKey(new Date(sk.last)), t) : null;
    if (d === null || d >= 1) items.push({ ic: 'sprout', c: C.practice, t: 'Practice ' + sk.name,
      st: d === null ? 'Not practiced yet' : d === 1 ? 'Last: yesterday' : 'Last: ' + d + ' days ago', act: 'practice-sheet', skill: sk.id });
  }
  H += `<div class="sec"><h2>Up next</h2></div><section class="list frost plan">` + items.map(it => `
    <button class="li${it.done ? ' done' : ''}" ${it.act ? `data-act="${it.act}"` : 'disabled'} ${it.tab ? `data-tab="${it.tab}"` : ''} ${it.seg ? `data-seg="${it.seg}"` : ''} ${it.skill ? `data-skill="${esc(it.skill)}"` : ''} style="--c:${it.c}">
      <span class="ic">${it.done ? icon('tick', 18, 2.6) : icon(it.ic, 19)}</span>
      <span class="tx"><div class="tt">${esc(it.t)}</div><div class="st">${esc(it.st)}</div></span>
      ${it.act ? `<span class="chev">${icon('chev', 16)}</span>` : ''}
    </button>`).join('') + `</section>`;

  H += `<div class="sec"><h2>Quick log</h2></div><section class="quick">
    ${quick('weigh-sheet', 'scale', '#40c8e0', 'Weigh-in', lastWeightLabel(v))}
    ${quick('vitals-sheet', 'moon', '#7d7aff', 'Vitals', v.bio[t] ? 'Logged today' : 'Sleep · energy · mood')}
    ${quick('practice-sheet', 'timer', '#30d158', 'Practice', pm ? pm + ' min today' : 'Log a session')}
    ${quick('note-sheet', 'note', '#ffb340', 'Note', 'Goes to your Journal')}
  </section>`;

  H += `<div class="sec"><h2>This week</h2><button class="link" data-act="review-sheet">Review</button></div><section class="card frost"><div class="week">` +
    [6, 5, 4, 3, 2, 1, 0].map(i => {
      const k = shiftDay(t, -i), frac = total ? doneOn(v, k) / total : 0;
      const trained = v.workouts.some(w => w.date === k);
      return `<div class="wd${i === 0 ? ' today' : ''}">${fmtDay(k, { weekday: 'narrow' })}
        ${ringSvg(frac, C.habits, 34, 5)}<span class="pip${trained ? ' on' : ''}"></span></div>`;
    }).join('') + `</div></section>`;

  const J = (v.journal || []).slice(0, 4);
  H += `<div class="sec"><h2>Journal</h2><button class="link" data-act="journal-sheet">${J.length ? 'See all' : 'Open'}</button></div>`;
  H += J.length ? `<section class="list frost">${J.map(e => journalRow(e)).join('')}</section>`
    : `<div class="card frost empty">Workouts, practice, weigh-ins and your notes land here — from the phone and the PC.</div>`;
  H += `<div class="foot" data-sync-label>${esc(syncLabel().text)}</div>`;
  return H;
}
/** The "open anywhere" card shows on the PC-served copy once it is paired and nothing is waiting to sync. */
function mv0() { const a = anywhere(); return a && !state.pending.length ? a : null; }

/** What Apple Health sent (via the Shortcut) for today and last night. Only fields that arrived are shown. */
function healthCard(v, t) {
  const b = v.bio[t] || {}, h = v.health;
  const fmtH = x => { const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return hh + ':' + String(mm).padStart(2, '0'); };
  const T = [
    ['moon', '#7d7aff', 'Sleep', b.sleep, x => fmtH(x), 'h'],
    ['heart', '#ff375f', 'Resting HR', b.rhr, x => Math.round(x), 'bpm'],
    ['heart', '#30d158', 'HRV', b.hrv, x => Math.round(x), 'ms'],
    ['target', '#30d158', 'Steps', b.steps, x => x >= 10000 ? fmt1(x / 1000) + 'k' : Math.round(x).toLocaleString(), ''],
    ['flame', '#ff9f0a', 'Active', b.active, x => Math.round(x), 'kcal'],
    ['sun', '#ffd60a', 'Daylight', b.daylight, x => Math.round(x), 'min'],
    ['bolt', '#40c8e0', 'VO₂max', b.vo2, x => fmt1(x), ''],
    ['timer', '#ff9f0a', 'Exercise', b.exmin, x => Math.round(x), 'min'],
    ['moon', '#bf5af2', 'REM', b.rem, x => fmtH(x), 'h'],
  ].filter(x => x[3] != null && x[3] !== 0);
  if (!T.length && !h) return `<div class="sec"><h2>Apple Health</h2></div><button class="card frost hl-cta" data-act="health-sheet">
    <span class="ic-dot" style="--c:#ff375f">${icon('heart', 17)}</span><span><b>Connect Apple Health</b><small>Sleep, heart rate, HRV, steps, daylight and VO₂max feed readiness, the mind model and the hormone estimate.</small></span>
    <span class="chev">${icon('chev', 16)}</span></button>`;
  const asOf = h && h.ts ? new Date(h.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + (h.day === t ? '' : ' · ' + fmtDay(h.day, { day: 'numeric', month: 'short' })) : '';
  return `<div class="sec"><h2>Apple Health</h2><button class="link" data-act="health-sheet">${asOf ? 'as of ' + esc(asOf) : 'Set up'}</button></div>
    <section class="card frost hl-grid">${T.length ? T.map(([ic, c, n, val, f, u]) => `<div style="--c:${c}"><span class="hi">${icon(ic, 14)}</span><b class="num">${f(val)}<small>${u ? ' ' + u : ''}</small></b><span>${n}</span></div>`).join('')
      : '<div class="sub" style="grid-column:1/-1">Nothing from Apple Health for today yet — your Shortcut runs on its schedule.</div>'}</section>`;
}
const JICON = { log: '📝', win: '🏆', lesson: '🎓', idea: '💡' };
/** One journal line; `del` adds a delete button to notes (not to the PC's automatic entries). */
export function journalRow(e, del = false) {
  const ic = e.type === 'note' ? (JICON[e.cat] || '📝') : e.type === 'habit' ? '🔥' : e.type === 'skill' ? '⬡' : '◆';
  const d = new Date(e.ts), when = isNaN(d) ? '' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const canDel = del && e.type === 'note' && (e.id != null || e.sid);
  return `<div class="jr${canDel ? ' del' : ''}"><span class="ic">${ic}</span><div><div class="tx">${esc(e.text)}</div><div class="when">${when}${e.src === 'phone' ? ' · 📱' : ''}</div></div>`
    + (canDel ? `<button class="circle sm" data-act="note-del" data-id="${esc(e.id ?? '')}" data-sid="${esc(e.sid || '')}" aria-label="Delete note">${icon('trash', 15)}</button>` : '') + `</div>`;
}
function quick(act, ic, c, title, sub) {
  return `<button class="qt frost" data-act="${act}" style="--c:${c}"><span class="qi">${icon(ic, 19)}</span>
    <span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>`;
}
function lastWeightLabel(v) {
  const k = Object.keys(v.weights).sort().pop();
  return k ? `${fmt1(v.weights[k])} kg · ${k === today() ? 'today' : fmtDay(k, { day: 'numeric', month: 'short' })}` : 'No weigh-ins yet';
}

/* ══════════════ HABITS ══════════════ */
const EFFECT_LBL = { sunlight: ['☀️', 'min light'], cold: ['🧊', 'min cold'], meditation: ['🧘', 'min calm'], walk: ['🚶', 'min walk'], mobility: ['🤸', 'min mobility'], sauna: ['🔥', 'min sauna'] };
export const effectText = e => e ? Object.keys(e).filter(k => e[k] > 0).map(k => (EFFECT_LBL[k] || ['', k])[0] + ' ' + e[k] + ' ' + (EFFECT_LBL[k] || ['', k])[1]).join(' · ') : '';
/** The habit (and day) just ticked: only that row plays the check animation, not every row on each redraw. */
let popKey = '';
export function renderHabits() {
  const v = view(), t = today();
  const done = doneOn(v, t), total = v.habits.length;
  let H = hdr(longDate(), 'Habits', syncButton() + `<button class="circle glass" data-act="habit-new" aria-label="New habit">${icon('plus', 20, 2.2)}</button>`);
  if (!total) return H + `<div class="card frost empty">No habits yet. Tap + to add one — it goes to ARK on your PC too.</div>`;
  const streaks = v.habits.map(h => ({ h, n: L.habitStreakOf(v.habitLog, h.id, t) })).sort((a, b) => b.n - a.n);
  H += `<section class="card frost row" style="gap:16px">
    ${ringSvg(done / total, C.habits, 72, 9, done)}
    <div style="flex:1;min-width:0"><div class="big num">${done}<small>of ${total} today</small></div>
      <div class="sub" style="margin-top:6px">${streaks[0] && streaks[0].n > 1 ? `🔥 Longest run now: ${esc(streaks[0].h.name)} · ${streaks[0].n} days` : 'Tap a circle to tick · a dot to fix a past day · the name to edit'}</div>
    </div></section>`;
  const order = Object.keys(PILLAR);
  const groups = {};
  v.habits.forEach(h => { (groups[h.pillar || 'custom'] = groups[h.pillar || 'custom'] || []).push(h); });
  Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).forEach(p => {
    const col = pillarColor(p, v);
    H += `<div class="grp-h">${esc((PILLAR[p] || PILLAR.custom)[0])}</div><section class="list frost">` + groups[p].map(h => {
      const on = !!(v.habitLog[t] && v.habitLog[t][h.id]);
      const n = L.habitStreakOf(v.habitLog, h.id, t);
      // Seven dots, the last one today: ticking the habit fills today's dot in the habit's colour too.
      const dots = [6, 5, 4, 3, 2, 1, 0].map(i => {
        const k = shiftDay(t, -i), d = !!(v.habitLog[k] && v.habitLog[k][h.id]);
        return `<button class="d7${d ? ' on' : ''}${i === 0 ? ' t' : ''}" data-act="habit" data-habit="${esc(h.id)}" data-day="${k}" data-done="${d ? 0 : 1}" aria-label="${esc(h.name)} ${i === 0 ? 'today' : 'on ' + fmtDay(k)}: ${d ? 'done' : 'not done'}"></button>`;
      }).join('');
      const pop = popKey === h.id + t ? ' pop' : '', eff = effectText(L.habitEffect(h));
      return `<div class="hb${on ? ' done' : ''}${pop}" style="--c:${col}">
        <button class="emo" data-act="habit-edit" data-id="${esc(h.id)}" aria-label="Edit ${esc(h.name)}">${esc(h.icon || '•')}</button>
        <div style="min-width:0"><button class="nm" data-act="habit-edit" data-id="${esc(h.id)}">${esc(h.name)}</button>
          <div class="meta">${dots}${n > 1 ? `<span class="strk">🔥 ${n}</span>` : ''}${eff ? `<span class="eff">${esc(eff)}</span>` : ''}</div></div>
        <button class="check${on ? ' on' : ''}" data-act="habit" data-habit="${esc(h.id)}" data-day="${t}" data-done="${on ? 0 : 1}" aria-label="${esc(h.name)} today" aria-pressed="${on}">${icon('tick', 20, 2.8)}</button>
      </div>`;
    }).join('') + `</section>`;
  });
  const hid = v.habitsHidden || [];
  if (hid.length) H += `<div class="grp-h">Hidden (${hid.length})</div><section class="list frost">${hid.map(h => `<div class="li"><span class="ic" style="--c:${pillarColor(h.pillar, v)}">${esc(h.icon || '•')}</span>
    <span class="tx"><div class="tt">${esc(h.name)}</div><div class="st">Not counted · its history is kept</div></span>
    <button class="btn sm btn-glass" data-act="habit-unhide" data-id="${esc(h.id)}">Show</button></div>`).join('')}</section>`;
  popKey = '';
  return H;
}

/* ══════════════ BODY ══════════════ */
export function vitalsCard(day) {
  const v = view(), b = v.bio[day] || {};
  const row = (ic, c, name, sub, ctrl) => `<div class="vrow" style="--c:${c}"><span class="vi">${icon(ic, 18)}</span>
    <div><div class="vn">${name}</div><div class="vs">${sub}</div></div><div>${ctrl}</div></div>`;
  const step = (f, val, d, unit, fmt = x => fmt1(x)) => `<div class="stepper">
    <button class="circle sm" data-act="bio-step" data-f="${f}" data-d="${-d}" aria-label="less">${icon('minus', 16)}</button>
    <span class="val num" style="min-width:66px;font-size:1.1rem">${val == null ? '—' : fmt(val) + (unit ? '<small style="font-size:.7rem;color:var(--t3)"> ' + unit + '</small>' : '')}</span>
    <button class="circle sm" data-act="bio-step" data-f="${f}" data-d="${d}" aria-label="more">${icon('plus', 16)}</button></div>`;
  let H = row('moon', '#7d7aff', 'Sleep', 'Hours last night', step('sleep', b.sleep, 0.5, 'h'));
  H += `<div class="vrow" style="--c:#ffd60a;grid-template-columns:34px 1fr"><span class="vi">${icon('bolt', 18)}</span>
    <div><div class="vn">Energy <span class="vs">${b.energy ? b.energy + ' / 10' : ''}</span></div>
    <div class="scale fill" style="margin-top:8px">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
      `<button class="${b.energy === n ? 'on' : ''}" data-act="bio-set" data-f="energy" data-v="${n}">${n}</button>`).join('')}</div></div></div>`;
  H += `<div class="vrow" style="--c:#5ee6b5;grid-template-columns:34px 1fr"><span class="vi">🙂</span>
    <div><div class="vn">Mood <span class="vs">${b.mood != null ? MOODS[b.mood][1] : ''}</span></div>
    <div class="moods">${MOODS.map((m, i) => `<button class="${b.mood === i ? 'on' : ''}" data-act="bio-set" data-f="mood" data-v="${i}" aria-label="${m[1]}">${m[0]}</button>`).join('')}</div></div></div>`;
  H += row('drop', '#40c8e0', 'Water', 'Litres', step('water', b.water, 0.25, 'L', x => x.toFixed(2).replace(/0$/, '')));
  H += row('meat', '#ff7a7a', 'Protein', 'Grams', `<div class="row" style="gap:6px"><span class="num" style="font-weight:700;min-width:44px;text-align:right">${b.prot || 0}g</span>
    <button class="btn sm btn-glass" data-act="bio-step" data-f="prot" data-d="25">+25</button>
    <button class="btn sm btn-glass" data-act="bio-step" data-f="prot" data-d="50">+50</button></div>`);
  return H;
}

/* ══════════════ GROW ══════════════ */
const LEVELS = ['Untrained', 'Novice', 'Competent', 'Proficient', 'Advanced', 'Expert'];
export function renderGrow() {
  const v = view(), t = today(), seg = state.growSeg || 'skills';
  let H = hdr(longDate(), 'Grow', syncButton());
  H += `<div class="seg" style="margin-bottom:16px">
    <button class="${seg === 'skills' ? 'on' : ''}" data-act="grow-seg" data-seg="skills">Skills</button>
    <button class="${seg === 'tree' ? 'on' : ''}" data-act="grow-seg" data-seg="tree">Tree</button>
    <button class="${seg === 'goals' ? 'on' : ''}" data-act="grow-seg" data-seg="goals">Goals</button>
    <button class="${seg === 'books' ? 'on' : ''}" data-act="grow-seg" data-seg="books">Books</button>
    <button class="${seg === 'lab' ? 'on' : ''}" data-act="grow-seg" data-seg="lab">Lab</button></div>`;
  if (seg === 'books') return H + renderBooks();
  if (seg === 'lab') return H + renderLab();

  if (seg === 'tree') {
    const tree = v.tree || [];
    if (!tree.length) return H + `<div class="card frost empty">The skill tree appears after the first sync with ARK on your PC.</div>`;
    return H + tree.map(p => {
      const done = p.skills.filter(s => s.status === 'done').length, prog = p.skills.filter(s => s.status === 'prog').length;
      return `<section class="tree-p frost" style="--pc:${p.color}"><div class="ph"><span class="dot"></span>${esc(String(p.name).split(' — ')[0])}
        <span class="k">${done}/${p.skills.length} activated${prog ? ' · ' + prog + ' training' : ''}</span></div>
        ${p.skills.slice().sort((a, b) => a.phase - b.phase).map(s => `<div class="tr"><div><div class="nm">${esc(s.name)}</div><div class="p2">PHASE ${s.phase}</div></div>
          <div class="tri">${[['none', 'None'], ['prog', 'Training'], ['done', 'Activated']].map(o =>
            `<button class="${s.status === o[0] ? 'on ' + o[0] : ''}" data-act="tree-set" data-skill="${esc(s.id)}" data-status="${o[0]}">${o[1]}</button>`).join('')}</div></div>`).join('')}
      </section>`;
    }).join('');
  }

  if (seg === 'skills') {
    const sk = v.skills.filter(s => s.status !== 'archived');
    const add = `<button class="btn btn-tint block" style="--accent:#bf5af2;margin-bottom:12px" data-act="skill-new">${icon('plus', 17)} New skill</button>`;
    if (!sk.length) return H + add + `<div class="card frost empty">No skills in play yet. Add one above, or mark a tree skill as Training.</div>`;
    return H + add + `<div class="stack">` + sk.map(s => {
      const col = pillarColor(s.cat, v);
      const streak = L.streakFromDays(s.days, t);
      const next = (s.milestones || []).find(m => !m.done);
      const pips = s.kind === 'custom' ? `<span class="pips" style="--c:${col}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= (s.level || 0) ? 'c' : i <= (s.target || 0) ? 't' : ''}"></i>`).join('')}</span>` : '';
      return `<section class="card frost" style="--c:${col}">
        <div class="row" style="margin-bottom:6px"><b style="font-size:1.05rem;flex:1;min-width:0">${esc(s.name)}</b>${pips}</div>
        ${s.kind === 'custom' ? `<div class="sub">${LEVELS[s.level || 0]} → ${LEVELS[s.target || 5]}</div>` : `<div class="sub">From the ARK tree</div>`}
        <div class="row num" style="gap:14px;margin:12px 0 4px;font-size:.88rem">
          <span><b>${s.count}</b> <span class="sub">session${s.count === 1 ? '' : 's'}</span></span><span><b>${fmtMins(s.mins)}</b></span>
          ${streak > 1 ? `<span style="color:var(--orange);font-weight:700">🔥 ${streak}</span>` : ''}
          <span class="spacer"></span><span class="sub">${s.last ? (L.dayKey(new Date(s.last)) === t ? 'today' : fmtDay(L.dayKey(new Date(s.last)), { day: 'numeric', month: 'short' })) : 'never'}</span></div>
        ${next ? `<div class="sub" style="margin:8px 0 2px"><span class="eyebrow" style="margin-right:6px">Next</span><span style="color:var(--t1)">${esc(next.t)}</span></div>` : ''}
        ${(s.milestones || []).length ? `<div style="margin-top:8px">${s.milestones.map((m, i) =>
          `<button class="ms${m.done ? ' on' : ''}" data-act="skill-ms" data-skill="${esc(s.id)}" data-i="${i}" data-done="${m.done ? 0 : 1}"><span class="mc">${m.done ? icon('tick', 14, 3) : ''}</span>${esc(m.t)}</button>`).join('')}</div>` : ''}
        ${s.kind === 'custom' ? `<div class="row" style="margin-top:10px;gap:10px"><span class="eyebrow" style="flex:1">Level · self-assessed</span>
          <button class="circle sm btn-glass" data-act="skill-level" data-skill="${esc(s.id)}" data-d="-1" ${(s.level || 0) <= 0 ? 'disabled' : ''} aria-label="Level down">${icon('minus', 15)}</button>
          <b style="min-width:92px;text-align:center;font-size:.86rem">${LEVELS[s.level || 0]}</b>
          <button class="circle sm btn-glass" data-act="skill-level" data-skill="${esc(s.id)}" data-d="1" ${(s.level || 0) >= 5 ? 'disabled' : ''} aria-label="Level up">${icon('plus', 15)}</button></div>` : ''}
        <button class="btn sm btn-tint" style="margin-top:12px;--accent:${col}" data-act="practice-sheet" data-skill="${esc(s.id)}">${icon('timer', 16)} Log practice</button>
      </section>`;
    }).join('') + `</div>`;
  }

  const act = v.goals.filter(g => g.status === 'active').sort((a, b) => (a.priority || 2) - (b.priority || 2));
  const other = v.goals.filter(g => g.status !== 'active' && g.status !== 'archived');
  const addG = `<button class="btn btn-tint block" style="--accent:#bf5af2;margin-bottom:12px" data-act="goal-new">${icon('plus', 17)} New goal</button>`;
  if (!act.length && !other.length) return H + addG + `<div class="card frost empty">No goals yet. Add one above — it lands in ARK on your PC as well.</div>`;
  return H + addG + `<div class="stack">` + act.concat(other).map(g => {
    const col = pillarColor(g.cat || 'life', v), p = L.goalProgress(g, g.habitRate);
    const due = g.due && g.status === 'active' ? (() => { const d = daysBetween(t, g.due); return d < 0 ? `<span class="tag" style="--c:#ff453a">${-d}d overdue</span>` : `<span class="tag" style="--c:${d <= 7 ? '#ffb340' : 'rgba(235,240,245,.6)'}">${d === 0 ? 'today' : d + 'd left'}</span>`; })() : '';
    let ctrl = '';
    if (g.status === 'active' && g.type === 'numeric') ctrl = `<div class="stepper" style="justify-content:center;margin-top:12px">
      <button class="circle btn-glass" data-act="goal-step" data-goal="${esc(g.id)}" data-d="-1">${icon('minus', 18)}</button>
      <span class="val num">${fmt1(g.current || 0)}<small style="font-size:.8rem;color:var(--t3)"> / ${fmt1(g.target || 0)} ${esc(g.unit || '')}</small></span>
      <button class="circle btn-glass" data-act="goal-step" data-goal="${esc(g.id)}" data-d="1">${icon('plus', 18)}</button></div>`;
    if (g.status === 'active' && g.type === 'manual') ctrl = `<div class="stepper" style="justify-content:center;margin-top:12px">
      <button class="circle btn-glass" data-act="goal-step" data-goal="${esc(g.id)}" data-d="-5">${icon('minus', 18)}</button>
      <span class="val num">${Math.round(g.current || 0)}%</span>
      <button class="circle btn-glass" data-act="goal-step" data-goal="${esc(g.id)}" data-d="5">${icon('plus', 18)}</button></div>`;
    if (g.type === 'checklist') ctrl = `<div style="margin-top:8px">${(g.milestones || []).map((m, i) =>
      `<button class="ms${m.done ? ' on' : ''}" ${g.status === 'active' ? '' : 'disabled'} data-act="goal-ms" data-goal="${esc(g.id)}" data-i="${i}" data-done="${m.done ? 0 : 1}"><span class="mc">${m.done ? icon('tick', 14, 3) : ''}</span>${esc(m.t)}</button>`).join('')}</div>`;
    if (g.type === 'consistency') ctrl = `<div class="sub" style="margin-top:8px">Progress is your linked habit's 30-day rate.</div>`;
    return `<section class="card frost"${g.status !== 'active' ? ' style="opacity:.6"' : ''}>
      <div class="row" style="align-items:flex-start"><b style="font-size:1.05rem;flex:1;min-width:0">${esc(g.title)}</b>${due}${g.status === 'done' ? '<span class="tag" style="--c:#30d158">Done</span>' : g.status === 'paused' ? '<span class="tag">Paused</span>' : ''}</div>
      <div class="row" style="margin-top:12px;gap:10px"><div class="bar" style="flex:1;--c:${col}"><i style="width:${Math.round(p * 100)}%"></i></div><b class="num" style="font-size:.9rem">${Math.round(p * 100)}%</b></div>
      ${ctrl}
      ${g.status === 'active' ? `<div class="row" style="margin-top:14px;gap:8px"><button class="btn sm btn-tint" style="--accent:#30d158" data-act="goal-status" data-goal="${esc(g.id)}" data-status="done">${icon('tick', 15, 2.6)} Complete</button></div>` : ''}
    </section>`;
  }).join('') + `</div>`;
}

/* ══════════════ actions ══════════════ */
/** Vitals taps coalesce into one queued event per day while it is unsent. */
export function bioPatch(day, fields) {
  const last = state.pending[state.pending.length - 1];
  if (last && !last.seq && last.type === 'bio.set' && last.data.day === day) {
    Object.assign(last.data.fields, fields); changed({ now: true }); scheduleSync(1500);
  } else emit('bio.set', { day, fields });
}
export const actions = {
  habit(d) {
    haptic();
    if (d.done === '1' && d.day === today()) popKey = d.habit + d.day;
    emit('habit.set', { habit: d.habit, day: d.day, done: d.done === '1' });
  },
  'bio-set'(d) {
    haptic();
    const t = today(), cur = (view().bio[t] || {})[d.f];
    const val = Number(d.v);
    bioPatch(t, { [d.f]: cur === val ? null : val });
  },
  'bio-step'(d) {
    const t = today(), cur = Number((view().bio[t] || {})[d.f]) || 0;
    const next = Math.max(0, Math.round((cur + Number(d.d)) * 100) / 100);
    bioPatch(t, { [d.f]: next || null });
  },
  'grow-seg'(d) { state.growSeg = d.seg; changed(); },
  'ca-recheck'() { haptic(); caState.trusted = null; checkCa().then(() => toast(caState.trusted ? 'Certificate trusted ✓' : 'Not trusted yet — finish the steps in Settings')); },
  'tree-set'(d) {
    const cur = ((view().tree || []).flatMap(p => p.skills).find(s => s.id === d.skill) || {}).status;
    if (cur === d.status) return;
    haptic(); emit('skill.status', { skill: d.skill, status: d.status });
    if (d.status === 'done') toast('⚡ Skill activated');
  },
  'skill-ms'(d) { haptic(); emit('skill.ms', { skill: d.skill, index: Number(d.i), done: d.done === '1' }); },
  'skill-level'(d) {
    const sk = view().skills.find(s => s.id === d.skill); if (!sk) return;
    const lv = Math.max(0, Math.min(5, (sk.level || 0) + Number(d.d)));
    if (lv === (sk.level || 0)) return;
    haptic(); emit('skill.level', { skill: d.skill, level: lv });
  },
  'goal-step'(d) {
    const g = view().goals.find(x => x.id === d.goal); if (!g) return;
    haptic(); emit('goal.set', { goal: g.id, current: Math.max(0, (Number(g.current) || 0) + Number(d.d)) });
  },
  'goal-ms'(d) { haptic(); emit('goal.ms', { goal: d.goal, index: Number(d.i), done: d.done === '1' }); },
  'goal-status'(d) {
    haptic(); emit('goal.status', { goal: d.goal, status: d.status });
    if (d.status === 'done') toast('◆ Goal completed', 'Undo', () => emit('goal.status', { goal: d.goal, status: 'active' }));
  },
};
