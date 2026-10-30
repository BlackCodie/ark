/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — logging by hand (2026-10-24: "make logging fancier, more
   modern and easier").

   One look for everything you log:
     • Log today rows — the value, how far to the goal, a one-tap add for
       the running totals (water, protein, calories). Tap a row for its sheet.
     • The log sheet — a big number you can type, a slider, picks from your
       own recent days, Save. Nothing is saved until you tap Save: the value
       it starts on (last night's sleep, your last weigh-in) is only a
       starting point, and the sheet says where it came from.
     • The check-in — mood faces and 1–10 meters for energy and stress.
   ══════════════════════════════════════════════════════════════════════ */
import { view, rawView, carriedFrom, emit, esc, icon, today, shiftDay, fmtDay, haptic, toast, openSheet, topSheet, closeSheet } from './core.js';
import { bioPatch } from './views.js';

/* add: a running total you add to through the day · set: one reading for the day.
   lo–hi is the slider; min–max what you can type; nudge is the − / + step. */
export const VIT = [
  { f: 'sleep', ic: 'moon', c: '#7d7aff', n: 'Sleep', u: 'h', kind: 'set', step: 0.25, nudge: 0.25, lo: 0, hi: 12, min: 0, max: 14, goal: 'sleep' },
  { f: 'deep', ic: 'moon', c: '#5e5ce6', n: 'Deep sleep', u: 'h', kind: 'set', step: 0.25, nudge: 0.25, lo: 0, hi: 4, min: 0, max: 6 },
  { f: 'prot', ic: 'meat', c: '#ff7a7a', n: 'Protein', u: 'g', kind: 'add', step: 5, nudge: 5, lo: 0, hi: 300, min: 0, max: 500, goal: 'prot', adds: [25, 50], quick: 25 },
  { f: 'water', ic: 'drop', c: '#40c8e0', n: 'Hydration', u: 'L', kind: 'add', step: 0.05, nudge: 0.25, lo: 0, hi: 6, min: 0, max: 10, goal: 'water', adds: [0.25, 0.5, 1], quick: 0.5 },
  { f: 'weight', ic: 'scale', c: '#64d2ff', n: 'Body weight', u: 'kg', kind: 'set', step: 0.1, nudge: 0.1, span: 12, min: 30, max: 250 },
  { f: 'steps', ic: 'target', c: '#30d158', n: 'Steps', u: 'steps', kind: 'set', step: 100, nudge: 500, lo: 0, hi: 30000, min: 0, max: 100000, goal: 'steps' },
  { f: 'cal', ic: 'flame', c: '#ff9f0a', n: 'Calories', u: 'kcal', kind: 'add', step: 10, nudge: 50, lo: 0, hi: 5000, min: 0, max: 10000, goal: 'cal', adds: [100, 250, 500], quick: 100 },
];
const byF = f => VIT.find(x => x.f === f);
const trim = n => String(+(+n).toFixed(2));
/** The big number's box fits what is typed, so the unit sits right beside it. */
export const inW = s => Math.max(1.6, String(s).length * 0.92 + 0.35).toFixed(2) + 'ch';
/** A value as the rows show it: 7.25 h, 1.5 L, 8,240 steps, 2,350 kcal. */
export function fmtV(x, n) {
  if (n == null || !isFinite(n)) return '—';
  return x.f === 'steps' || x.f === 'cal' ? Math.round(n).toLocaleString('en-US') : x.f === 'prot' ? String(Math.round(n)) : trim(n);
}
const unitOf = x => (x.f === 'steps' ? '' : x.u);
const hmin = h => { const m = Math.round(h * 60); return Math.floor(m / 60) + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : ''); };
/** A zero in a running total means "not logged yet", never a value. */
const logged = (x, n) => n != null && isFinite(n) && !(x.kind === 'add' && n === 0);
const latestWeight = v => { const k = Object.keys(v.weights || {}).sort().pop(); return k ? v.weights[k] : ((v.profile || {}).weight || null); };
/** The most recent earlier day you logged a value on, within a week (carried copies are not "logged"). */
function before(v, t, f) {
  const B = v.raw ? v.raw.bio : v.bio;
  for (let i = 1; i <= 7; i++) { const k = shiftDay(t, -i), n = (B[k] || {})[f]; if (n != null && n !== 0) return { n, k, i }; }
  return null;
}
const ago = p => (p.i === 1 ? 'yesterday' : fmtDay(p.k, { weekday: 'short' }));
/** "yesterday", or the weekday of an earlier day (for "carried from …"). */
export const dayName = (k, t = today()) => (k === shiftDay(t, -1) ? 'yesterday' : fmtDay(k, { weekday: 'short', day: 'numeric', month: 'short' }));

/* ── Log today ── */
export function logRows(v, t, only) {
  const d = v.bio[t] || {}, G = (v.bioDefs && v.bioDefs.goals) || {}, cf = (v.carry || {})[t] || {};
  return `<div class="lg-list">${VIT.filter(x => !only || only.includes(x.f)).map(x => {
    const cur = d[x.f], has = logged(x, cur), goal = x.goal ? G[x.goal] : null, carried = has ? cf[x.f] || null : null;
    const pct = goal && has ? Math.min(1, cur / goal) : 0;
    const p = has ? null : x.f === 'weight' ? null : before(v, t, x.f);
    const lw = !has && x.f === 'weight' ? latestWeight(v) : null;
    const hint = carried ? '↻ carried from ' + dayName(carried, t) : has ? (goal ? (cur >= goal ? 'goal reached' : Math.round(cur / goal * 100) + ' % of ' + fmtV(x, goal) + (unitOf(x) ? ' ' + unitOf(x) : '')) : 'logged today')
      : p ? ago(p) + ' ' + fmtV(x, p.n) + (unitOf(x) ? ' ' + unitOf(x) : '') : lw ? 'last ' + fmtV(x, lw) + ' kg' : 'tap to log';
    return `<div class="lg${has ? ' on' : ''}${carried ? ' carried' : ''}${goal && has && cur >= goal && !carried ? ' done' : ''}" style="--c:${x.c}">
      <button class="lg-main" data-act="lg-open" data-f="${x.f}" aria-label="${x.n}${has ? ' ' + fmtV(x, cur) + ' ' + x.u : ''} — open to log">
        <span class="lg-ic">${icon(x.ic, 18)}</span>
        <span class="lg-tx"><span class="lg-n">${x.n}</span><span class="lg-h">${esc(hint)}</span></span>
        <span class="lg-v num">${has ? fmtV(x, cur) + (unitOf(x) ? `<small>${unitOf(x)}</small>` : '') : '<i>—</i>'}</span>
        ${x.kind === 'add' ? '' : `<span class="lg-chev">${icon('chev', 15)}</span>`}
      </button>
      ${x.kind === 'add' ? `<button class="lg-add" data-act="lg-add" data-f="${x.f}" data-d="${x.quick}" aria-label="Add ${fmtV(x, x.quick)} ${x.u} ${x.n.toLowerCase()}">+${fmtV(x, x.quick)}<small>${x.u}</small></button>` : ''}
      ${goal ? `<span class="lg-bar"><i style="width:${(pct * 100).toFixed(1)}%"></i></span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

/* ── the log sheet ── */
let ls = { f: null, v: 0, from: '' };
function startOf(v, t, x) {
  const cur = (v.bio[t] || {})[x.f], cd = carriedFrom(t, x.f);
  if (logged(x, cur)) return { v: cur, from: cd ? dayName(cd, t) + "'s, carried" : '' };
  if (x.kind === 'add') return { v: 0, from: '' };
  if (x.f === 'weight') { const w = latestWeight(v); return w ? { v: w, from: 'your last weigh-in' } : { v: 75, from: '' }; }
  const p = before(v, t, x.f);
  return p ? { v: p.n, from: ago(p) + "'s " + x.n.toLowerCase() } : { v: x.f === 'sleep' ? 7 : x.f === 'deep' ? 1.5 : 0, from: '' };
}
function rangeOf(x) {
  if (x.f === 'weight') { const c = Math.round(ls.v); return [Math.max(x.min, c - x.span), Math.min(x.max, c + x.span)]; }
  return [x.lo, Math.max(x.hi, Math.ceil(ls.v / x.step) * x.step)];
}
const clampV = (x, n) => Math.max(x.min, Math.min(x.max, Math.round(n / x.step) * x.step));
function note(x) {
  const v = view(), t = today(), cur = (v.bio[t] || {})[x.f], G = (v.bioDefs && v.bioDefs.goals) || {}, goal = x.goal ? G[x.goal] : null;
  const u = unitOf(x) ? ' ' + unitOf(x) : '';
  const parts = [];
  if (x.f === 'sleep' || x.f === 'deep') parts.push(hmin(ls.v));
  if (goal) parts.push(Math.round(ls.v / goal * 100) + ' % of your ' + fmtV(x, goal) + u + ' goal');
  const cd = carriedFrom(t, x.f);
  const head = cd ? (Math.abs(cur - ls.v) < 1e-9 ? '↻ Carried from ' + dayName(cd, t) + ' — Save to log it as today\'s' : '↻ ' + fmtV(x, cur) + u + ' carried from ' + dayName(cd, t) + ' — Save to log this instead')
    : logged(x, cur) ? (Math.abs(cur - ls.v) < 1e-9 ? 'Saved today' : 'Saved today: ' + fmtV(x, cur) + u + ' — Save to change it')
    : x.kind === 'add' ? 'Today so far — add to it below' : ls.from ? 'Not logged today · starts at ' + ls.from : 'Not logged today';
  return `<b>${esc(head)}</b>${parts.length ? '<br>' + esc(parts.join(' · ')) : ''}`;
}
function week(v, t, x) {
  const days = [6, 5, 4, 3, 2, 1, 0].map(i => shiftDay(t, -i)), vals = days.map(k => k === t ? ls.v : (v.bio[k] || {})[x.f]), cf = v.carry || {};
  const ok = vals.map(n => n != null && n !== 0), hi = Math.max(...vals.filter((n, i) => ok[i]), 1e-9);
  if (ok.filter(Boolean).length < 2) return '';
  return `<div class="ls-week" style="--c:${x.c}"><div class="eyebrow">Your week${days.some(k => k !== t && (cf[k] || {})[x.f]) ? ' · faint = carried' : ''}</div><div class="ls-bars">${days.map((k, i) => `<span class="${k === t ? 't' : ''}${k !== t && (cf[k] || {})[x.f] ? ' c' : ''}">
    <b class="num">${ok[i] ? fmtV(x, vals[i]) : ''}</b><i style="height:${ok[i] ? Math.max(6, vals[i] / hi * 54) : 3}px"></i>${fmtDay(k, { weekday: 'narrow' })}</span>`).join('')}</div></div>`;
}
function picks(v, t, x) {
  if (x.kind === 'add') return x.adds.map(a => `<button class="chip num" data-act="ls-plus" data-d="${a}">+${fmtV(x, a)} ${x.u}</button>`).join('')
    + (ls.v > 0 ? `<button class="chip" data-act="ls-pick" data-v="0">Reset to 0</button>` : '');
  const G = (v.bioDefs && v.bioDefs.goals) || {}, out = [], u = unitOf(x) ? ' ' + unitOf(x) : '';
  const p = before(v, t, x.f); if (p) out.push([p.n, (p.i === 1 ? 'Yesterday' : fmtDay(p.k, { weekday: 'short' })) + ' ' + fmtV(x, p.n) + u]);
  const w = [1, 2, 3, 4, 5, 6, 7].map(i => ((v.raw ? v.raw.bio : v.bio)[shiftDay(t, -i)] || {})[x.f]).filter(n => n != null && n !== 0);
  if (w.length >= 3) { const a = clampV(x, w.reduce((s, n) => s + n, 0) / w.length); out.push([a, '7-day avg ' + fmtV(x, a) + u]); }
  if (x.goal && G[x.goal]) out.push([G[x.goal], 'Goal ' + fmtV(x, G[x.goal]) + u]);
  if (x.f === 'weight') { const lw = latestWeight(v); if (lw) out.push([lw, 'Last weigh-in ' + fmtV(x, lw) + ' kg']); }
  const seen = new Set();
  return out.filter(([n]) => !seen.has(n) && seen.add(n)).map(([n, l]) => `<button class="chip num${Math.abs(n - ls.v) < 1e-9 ? ' on' : ''}" data-act="ls-pick" data-v="${n}">${esc(l)}</button>`).join('');
}
export function logSheet(f) {
  const x = byF(f); if (!x) return;
  const s0 = startOf(view(), today(), x);
  ls = { f, v: s0.v, from: s0.from };
  openSheet({
    id: 'log', title: x.n,
    render: () => {
      const v = view(), t = today(), cur = (v.bio[t] || {})[x.f], [lo, hi] = rangeOf(x), val = clampV(x, ls.v);
      return `<div class="ls-hero" style="--c:${x.c}">
          <span class="ls-ic">${icon(x.ic, 22)}</span>
          <div class="ls-row">
            <button class="ls-nudge" data-act="ls-nudge" data-d="${-x.nudge}" aria-label="Less">${icon('minus', 22)}</button>
            <label class="ls-val"><input class="ls-in num" data-ls-in inputmode="decimal" enterkeyhint="done" value="${trim(val)}" style="width:${inW(trim(val))}" aria-label="${x.n} in ${x.u}"><span class="u">${x.u}</span></label>
            <button class="ls-nudge" data-act="ls-nudge" data-d="${x.nudge}" aria-label="More">${icon('plus', 22)}</button>
          </div>
          <div class="ls-note" data-ls-note>${note(x)}</div>
        </div>
        <input type="range" class="ls-range" data-ls-range min="${lo}" max="${hi}" step="${x.step}" value="${val}" style="--c:${x.c};--p:${((val - lo) / (hi - lo || 1) * 100).toFixed(2)}%" aria-label="${x.n}">
        <div class="ls-scale num"><span>${fmtV(x, lo)}</span><span>${fmtV(x, (lo + hi) / 2)}</span><span>${fmtV(x, hi)}</span></div>
        <div class="chips ls-picks" style="--accent:${x.c}">${picks(v, t, x)}</div>
        <button class="btn btn-prominent block ls-save" style="--accent:${x.c}" data-act="ls-save">Save ${x.n.toLowerCase()}</button>
        ${logged(x, cur) ? `<button class="ls-clear" data-act="ls-clear">${carriedFrom(t, x.f) ? 'Not today — drop the carried value' : "Clear today's " + x.n.toLowerCase()}</button>` : ''}
        ${week(v, t, x)}`;
    },
  });
}
/** Slider and typed number stay in step without redrawing the sheet (that would drop the drag or the keyboard). */
export function onLogInput(el) {
  const x = byF(ls.f); if (!x) return false;
  const s = el.closest('[data-sheet="log"]'); if (!s) return false;
  if (el.matches('[data-ls-range]')) {
    ls.v = Number(el.value);
    const i = s.querySelector('[data-ls-in]'); if (i) { i.value = trim(ls.v); i.style.width = inW(i.value); }
  } else if (el.matches('[data-ls-in]')) {
    const n = Number(String(el.value).replace(',', '.'));
    if (!(el.value.trim() && isFinite(n))) return true;
    ls.v = n; el.style.width = inW(el.value);
    const r = s.querySelector('[data-ls-range]'); if (r) r.value = String(Math.max(+r.min, Math.min(+r.max, n)));
  } else return false;
  const r = s.querySelector('[data-ls-range]');
  if (r) r.style.setProperty('--p', ((Math.max(+r.min, Math.min(+r.max, ls.v)) - r.min) / ((r.max - r.min) || 1) * 100).toFixed(2) + '%');
  const nt = s.querySelector('[data-ls-note]'); if (nt) nt.innerHTML = note(x);
  return true;
}

/* ── the check-in: mood faces, energy and stress meters ── */
export const ENERGY_WORDS = ['Empty', 'Drained', 'Low', 'Low', 'OK', 'OK', 'Good', 'Good', 'Charged', 'Charged'];
export const STRESS_WORDS = ['Calm', 'Calm', 'Light', 'Light', 'Moderate', 'Moderate', 'High', 'High', 'Overloaded', 'Overloaded'];
export function meter(f, label, c, cur, words, carried = null) {
  return `<div class="mtr-h"><span class="eyebrow">${label}</span><span class="mtr-v num" style="--c:${c}">${cur ? `<b>${cur}</b><small>/10</small> ${esc(words[cur - 1])}${carried ? `<small class="cf"> · ↻ ${esc(dayName(carried))} — tap to confirm</small>` : ''}` : '<small>tap a level</small>'}</span></div>
    <div class="mtr${carried ? ' carried' : ''}" style="--c:${c}" role="group" aria-label="${label}">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n =>
      `<button class="${cur && n <= cur ? 'f' : ''}${cur === n ? ' on' : ''}" style="--o:${(0.3 + n * 0.07).toFixed(2)}" data-act="bio-set" data-f="${f}" data-v="${n}" aria-label="${label} ${n} of 10" aria-pressed="${cur === n}"><span>${n}</span></button>`).join('')}</div>`;
}
/** levels: [{ e, n, c }] — the PC's mood levels when synced, else the phone's own six. */
export function moodRow(levels, cur, carried = null) {
  return `<div class="mood2${carried ? ' carried' : ''}">${levels.map((m, i) => `<button class="${cur === i ? 'on' : ''}" style="--c:${m.c || '#5ee6b5'}" data-act="bio-set" data-f="mood" data-v="${i}" aria-label="${esc(m.n)}" aria-pressed="${cur === i}"><span class="e">${m.e}</span></button>`).join('')}</div>
    <div class="mood2-cap">${cur != null && levels[cur] ? esc(levels[cur].n) + (carried ? `<span class="cf">↻ ${esc(dayName(carried))} — tap to confirm</span>` : '') : 'How do you feel?'}</div>`;
}

export const actions = {
  'lg-open'(d) { haptic(); logSheet(d.f); },
  'lg-add'(d) {
    const x = byF(d.f); if (!x) return;
    const t = today(), cur = Number((rawView().bio[t] || {})[d.f]) || 0, nv = Math.min(x.max, Math.round((cur + Number(d.d)) * 100) / 100);
    haptic(); bioPatch(t, { [d.f]: nv });
  },
  'ls-nudge'(d) { const x = byF(ls.f); if (!x) return; ls.v = clampV(x, ls.v + Number(d.d)); haptic(); topSheet()?.refresh(); },
  'ls-plus'(d) { const x = byF(ls.f); if (!x) return; ls.v = clampV(x, ls.v + Number(d.d)); haptic(); topSheet()?.refresh(); },
  'ls-pick'(d) { const x = byF(ls.f); if (!x) return; ls.v = clampV(x, Number(d.v)); haptic(); topSheet()?.refresh(); },
  'ls-save'() {
    const x = byF(ls.f); if (!x) return;
    const el = document.querySelector('[data-sheet="log"] [data-ls-in]');
    const n = el ? Number(String(el.value).replace(',', '.')) : ls.v;
    if (!isFinite(n) || n < x.min || n > x.max) { toast(`Enter ${fmtV(x, x.min)}–${fmtV(x, x.max)} ${x.u}`); return; }
    const val = Math.round(n * 100) / 100;
    bioPatch(today(), { [x.f]: x.kind === 'add' && val === 0 ? null : val });
    haptic(); closeSheet(topSheet());
    toast(x.n + ' · ' + fmtV(x, val) + (unitOf(x) ? ' ' + unitOf(x) : ' steps') + ' saved');
  },
  'ls-clear'() {
    const x = byF(ls.f); if (!x) return;
    const t = today(), real = logged(x, (rawView().bio[t] || {})[x.f]);
    // A logged value is cleared (the day before may then carry in, marked); a carried one is dropped for today.
    if (real) bioPatch(t, { [x.f]: null }); else emit('bio.nocarry', { day: t, key: x.f, on: true });
    haptic(); closeSheet(topSheet()); toast(real ? x.n + ' cleared for today' : 'Not today — ' + x.n.toLowerCase() + ' is no longer carried');
  },
};
