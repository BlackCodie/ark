/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — doses and what they do over time (logic/src/pk.ts).

   Every supplement you log carries the time you took it. The kinetics model
   turns the doses into estimates: how much is circulating now (on top of the
   body's own baseline), when it peaks and clears, and — for things the body
   stores — how full the store is. These are population-average estimates of
   AMOUNTS, never lab measurements, and every screen says so.
   ══════════════════════════════════════════════════════════════════════ */
import { inW } from './logui.js';
import { L, state, view, rawView, emit, emitUndoable, dropPending, esc, icon, today, fmt1, uid, toast, haptic, openSheet, topSheet, closeSheet } from './core.js';

const H = 3600e3;
export const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtAmt = (n, unit) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = a >= 1000 ? Math.round(n).toLocaleString() : a >= 100 ? String(Math.round(n)) : a >= 10 ? n.toFixed(1).replace(/\.0$/, '') : a >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, '');
  return s + (unit ? ' ' + unit : '');
};
export const doses = () => view().doses || [];
export const defOf = k => ((view().bioDefs || {}).micros || []).find(m => m.k === k) || null;
const dayOf = t => L.dayKey(new Date(t));
/** When you last took it today (ms), or null. */
export function takenAt(k, t = today()) {
  const a = doses().filter(x => x.k === k && dayOf(Date.parse(x.at)) === t).map(x => Date.parse(x.at));
  return a.length ? Math.max(...a) : null;
}
/** What you take regularly: logged on 3+ different days in the last 30 (a dose or a day's total), most recent first.
 *  Only real logs count — a carried day must not keep a supplement "regular" on its own. */
export function regulars(v0 = view(), t = today()) {
  const D = v0.bioDefs; if (!D || !D.micros) return [];
  const v = v0.raw ? { bio: v0.raw.bio, doses: v0.raw.doses } : v0;
  const last = {}, days = {}, cut = L.shiftDayKey(t, -30);
  const saw = (k, day) => { if (!day || day > t) return; if (!last[k] || day > last[k]) last[k] = day; if (day >= cut) (days[k] = days[k] || new Set()).add(day); };
  (v.doses || []).forEach(x => saw(x.k, dayOf(Date.parse(x.at))));
  Object.keys(v.bio || {}).forEach(day => { const mc = (v.bio[day] || {}).micros || {}; Object.keys(mc).forEach(k => { if (mc[k] > 0) saw(k, day); }); });
  return D.micros.filter(m => days[m.k] && days[m.k].size >= 3).sort((x, y) => (last[y.k] || '').localeCompare(last[x.k] || ''));
}
/** What you usually take of it — remembered from the doses you logged (logic/pk.ts usualDose), or null. */
export const usualOf = k => L.usualDose(k, rawView().doses || []);

/** Where one nutrient stands now — the numbers the list rows and the sheet share. */
export function standing(k, now = Date.now()) {
  const P = L.pkNow(k, doses(), now);
  if (!P) return null;
  const sp = P.spec, out = { P, sp, line: '', sub: '', store: null, recent: false };
  const u = sp.mass;
  // Only what you logged is estimated. With no dose in the last 3 days nothing is claimed about your blood —
  // the "typical adult baseline" is not your number, and showing it read as if it were (2026-10-10).
  out.recent = doses().some(d => d.k === k && now - Date.parse(d.at) < 72 * H && now >= Date.parse(d.at));
  if (sp.where === 'gut') { out.line = 'Works in the gut — not absorbed'; return out; }
  if (sp.zeroOrder) {
    const g = P.inBody;
    out.line = g >= 0.5 ? `~${fmtAmt(g / 14, '')} drink${g / 14 >= 1.5 ? 's' : ''} still in you` : 'None in you now';
    out.sub = g >= 0.5 && P.clearAt ? 'Cleared by ~' + hm(P.clearAt) : '';
    return out;
  }
  if (sp.where === 'body') {
    out.line = P.inBody >= 0.5 ? `~${fmtAmt(P.inBody, u)} in your body now` : 'None in you now';
    if (k === 'caffeine') {
      const bed = bedtimeTonight(), atBed = L.amountAt('caffeine', doses(), bed);
      out.sub = P.inBody >= 0.5 ? `~${Math.round(atBed)} mg left at ${hm(bed)} bedtime` : '';
    }
    return out;
  }
  if (!out.recent) {
    out.line = 'Nothing logged in the last 3 days';
    out.sub = sp.baseline !== null ? 'Your body keeps some from food — ARK only estimates what you log.' : '';
  } else if (sp.baseline !== null) {
    const extra = P.extraInBlood;
    // As a share of what the blood normally holds: "+1.7 mg" means nothing beside a ~290 mg pool (2026-10-24).
    const pct = P.pctOfBaseline, pctTxt = pct == null ? '' : pct < 0.1 ? ' (under 0.1 % of the usual ~' + fmtAmt(sp.baseline, u) + ')' : ' (+' + pct + ' % on the usual ~' + fmtAmt(sp.baseline, u) + ')';
    out.line = extra >= sp.baseline * 0.005 ? `+${fmtAmt(extra, u)} in your blood now${pctTxt}` : 'Cleared — back to your usual level';
    out.sub = 'On top of what your body keeps from food, which ARK does not know.';
  } else {
    out.line = P.extraInBlood >= 0.05 ? `~${fmtAmt(P.extraInBlood, u)} circulating from your doses` : 'Cleared — nothing circulating now';
  }
  out.store = storeOf(k);
  return out;
}

/** Slow stores: creatine in muscle, vitamin D, omega-3 index, ashwagandha's built effect. */
function storeOf(k) {
  const t = today(), D = doses();
  const days = n => L.dailyTotals(k, D, t, n, x => dayOf(x));
  const any = n => days(n).some(x => x > 0);
  if (k === 'creatine') {
    if (!any(120)) return null;
    // By the hour (logic/pk.ts creatineStoreAt): a dose fills the store over the hours after it, a day without one lets it fall.
    const C = L.creatineStoreAt(D, Date.now()), dd = x => new Date(x).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const avg = Math.round(D.filter(x => x.k === 'creatine' && Date.now() - Date.parse(x.at) < 7 * 864e5).reduce((a, x) => a + Number(x.amount), 0) / 7 * 10) / 10;
    const note = C.sat >= 0.95 ? 'Saturated — a daily dose keeps it there.'
      : C.trend === 'rising' ? 'Filling' + (C.absorbing >= 0.1 ? ' — ' + fmtAmt(C.absorbing, 'g') + ' of your last dose is still being taken up' : '')
        + (C.fullAt ? '. Full around ' + dd(C.fullAt) + ' at your recent ' + avg + ' g a day.' : avg > 0 ? '. At your recent ' + avg + ' g a day it levels off near ' + Math.round(Math.min(1, avg / 2) * 100) + ' % — about 2 g a day keeps it full.' : '.')
      : C.trend === 'falling' ? 'Emptying — no creatine in the last 24 h' + (C.baseAt ? '; back near your baseline around ' + dd(C.baseAt) + ' without more.' : '.')
      : 'Holding steady.';
    return { label: 'Muscle creatine store', v: Math.round(C.sat * 100), unit: '% saturated' + (C.trend === 'rising' ? ' ↑' : C.trend === 'falling' ? ' ↓' : ''), note, series: C.series };
  }
  if (k === 'vitd') {
    const lab = labFor(/vitamin\s*d|25.?oh/i);
    if (!lab && !any(90)) return null;
    const st = L.vitaminDStatus(days(90), lab);
    const band = st.level < 20 ? ['likely low', '#ff9f0a'] : st.level < 30 ? ['borderline', '#ffd60a'] : st.level <= 70 ? ['likely adequate', '#30d158'] : ['high end', '#ff9f0a'];
    return { label: 'Vitamin D status (estimate)', text: band[0], color: band[1],
      note: st.basis === 'lab' ? 'Anchored to your lab result, adjusted for what you have taken since.' : 'No lab result yet — started from a typical unsupplemented level. A 25(OH)D test replaces the guess.' };
  }
  if (k === 'omega') {
    if (!any(120)) return null;
    const idx = L.omega3Index(days(120));
    return { label: 'Omega-3 index (estimate)', v: fmt1(idx), unit: '%', note: 'Builds into red-cell membranes over ~3–4 months; 8 %+ is the range linked with the benefits in studies.' };
  }
  if (k === 'ashwa') {
    if (!any(90)) return null;
    const b = L.builtEffect(days(90), 600);
    return { label: 'Effect built up', v: Math.round(b * 100), unit: '% of trial effect', note: 'The cortisol drop in trials appears after 4–8 weeks of daily use; it feeds the calm and cortisol estimates.' };
  }
  return null;
}
function labFor(re) {
  const b = (view().bloodwork || []).filter(x => re.test(x.marker) && isFinite(parseFloat(x.value))).sort((a, c) => String(c.date).localeCompare(String(a.date)))[0];
  if (!b) return null;
  return { value: parseFloat(b.value), unit: b.unit || '', daysAgo: Math.max(0, Math.round((Date.now() - Date.parse(b.date + 'T12:00:00')) / 864e5)) };
}
/** Tonight's bedtime: Apple Health's recent bedtimes if there are any, else 23:00. */
export function bedtimeTonight() {
  const v = view(), t = today(), hs = [];
  for (let i = 0; i < 14; i++) { const b = (v.bio[L.shiftDayKey(t, -i)] || {}).bed; if (typeof b === 'number') hs.push(b < 12 ? b + 24 : b); }
  hs.sort((a, b) => a - b);
  const h = hs.length ? hs[Math.floor(hs.length / 2)] : 23;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.getTime() + h * H;
}

/* ── logging ── */
export function logDose(k, amount, at) {
  const def = defOf(k), a = Number(amount);
  if (!(a > 0)) return;
  const t0 = today(), cur = ((rawView().bio[t0] || {}).micros || {})[k] || 0;
  const before = L.microSafety(k, cur);
  emit('dose.add', { dose: { id: 'd' + uid(), k, amount: a, at: new Date(at).toISOString() } });
  haptic();
  const after = L.microSafety(k, cur + a);
  if (after && after.level === 'over' && !(before && before.level === 'over')) toast('⚠ ' + (def ? def.name : k) + ' is over its upper limit (' + after.ul + ' ' + after.unit + ')');
  else toast((def ? def.icon + ' ' : '') + fmtAmt(a, def ? def.unit : '') + ' ' + (def ? def.name : k) + ' · ' + hm(at));
}

/* ── the dose sheet ── */
let ds = { k: null, amt: 0, off: 0, custom: '' };
function curveSvg(P) {
  const pts = P.curve, now = Date.now();
  const W = 320, h = 90, pad = 4, hi = Math.max(...pts.map(p => p.v), 1e-9);
  const x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  const X = t => pad + (t - x0) / (x1 - x0) * (W - 2 * pad), Y = v => h - 14 - v / hi * (h - 26);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
  const ticks = [-6, 0, 6, 12, 18].map(o => { const t = now + o * H; return `<text x="${X(t).toFixed(1)}" y="${h - 1}" text-anchor="middle" font-size="9" fill="rgba(235,240,245,.45)" font-family="system-ui">${o === 0 ? 'now' : hm(t)}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:${h}px" preserveAspectRatio="none" role="img" aria-label="Estimated amount over the day">
    <path d="${line} L${X(x1)},${h - 14} L${X(x0)},${h - 14} Z" fill="rgba(64,200,224,.14)"/>
    <path d="${line}" fill="none" stroke="#40c8e0" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <line x1="${X(now)}" x2="${X(now)}" y1="4" y2="${h - 14}" stroke="rgba(255,255,255,.5)" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
    ${ticks}</svg>`;
}
/** A store's last 30 days (one point a day, then now) as a small line. */
function storeSpark(pts) {
  if (!pts || pts.length < 2) return '';
  const W = 320, h = 54, x0 = pts[0].t, x1 = pts[pts.length - 1].t;
  const X = t => 2 + (t - x0) / ((x1 - x0) || 1) * (W - 4), Y = v => h - 12 - Math.max(0, Math.min(1, v)) * (h - 18);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' ');
  return `<svg class="store-spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="The store over the last 30 days">
    <line x1="2" x2="${W - 2}" y1="${Y(1)}" y2="${Y(1)}" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
    <path d="${line} L${X(x1)},${h - 12} L${X(x0)},${h - 12} Z" fill="rgba(48,209,88,.14)"/>
    <path d="${line}" fill="none" stroke="#30d158" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
    <circle cx="${X(x1)}" cy="${Y(pts[pts.length - 1].v)}" r="3" fill="#30d158"/>
    <text x="2" y="${h - 1}" font-size="9" fill="rgba(235,240,245,.45)" font-family="system-ui">30 days ago</text><text x="${W - 2}" y="${h - 1}" text-anchor="end" font-size="9" fill="rgba(235,240,245,.45)" font-family="system-ui">now</text></svg>`;
}
const trimN = n => String(+(+n).toFixed(3));
const WHEN = [[0, 'Now'], [30, '30 min ago'], [60, '1 h ago'], [120, '2 h ago'], [240, '4 h ago']];
/** The Log button says exactly what will be saved. */
function logLabel(def) {
  const tm = document.querySelector('[data-ds-time]')?.value;
  return 'Log ' + fmtAmt(ds.amt, def.unit) + ' · ' + (tm ? tm : ds.off ? WHEN.find(w => w[0] === ds.off)[1] : 'now');
}
export function doseSheet(k, preset) {
  const def = defOf(k); if (!def) return;
  const u = usualOf(k);
  ds = { k, amt: preset || (u && u.amount) || (def.steps || [])[0] || def.goal || 1, off: 0, custom: '' };
  const s = openSheet({
    id: 'dose', title: def.icon + ' ' + def.name,
    render: () => {
      const v = view(), t = today(), S = standing(k), sp = S && S.sp, u = usualOf(k);
      const todayAmt = ((v.bio[t] || {}).micros || {})[k] || 0;
      const saf = L.microSafety(k, todayAmt);
      const mine = doses().filter(x => x.k === k && dayOf(Date.parse(x.at)) === t).sort((a, b) => b.at.localeCompare(a.at));
      const dosed = doses().some(x => x.k === k && Date.now() - Date.parse(x.at) < 72 * 3600e3);
      const pend = new Set(state.pending.filter(e => !e.seq && e.type === 'dose.add').map(e => e.data.dose.id));
      const nudge = Math.min(...(def.steps || [1]).filter(x => x > 0), u ? u.amount : Infinity);
      const amts = [...new Set([u && u.amount, ...(def.steps || []), def.goal].filter(x => x > 0))];
      // logging first: the amount you usually take, ready to go
      let H0 = `<div class="ls-hero ds-hero" style="--c:${def.c || '#40c8e0'}">
          <div class="ds-cap">${u ? '★ Your usual dose' : 'Dose'}</div>
          <div class="ls-row">
            <button class="ls-nudge" data-act="ds-nudge" data-d="${-nudge}" aria-label="Less">${icon('minus', 22)}</button>
            <label class="ls-val"><input class="ls-in num" data-ds-amt inputmode="decimal" enterkeyhint="done" value="${trimN(ds.amt)}" style="width:${inW(trimN(ds.amt))}" aria-label="Amount in ${esc(def.unit)}"><span class="u">${esc(def.unit)}</span></label>
            <button class="ls-nudge" data-act="ds-nudge" data-d="${nudge}" aria-label="More">${icon('plus', 22)}</button>
          </div>
          <div class="ls-note">${u ? `Remembered from your last doses — ${u.times > 1 ? u.times + ' of your last ' + u.of + ' times' : 'last time'}. Change it and ARK remembers the new one.` : 'ARK remembers the amount you log and starts here next time.'}</div>
        </div>
        <div class="chips ds-picks">${amts.map(a => `<button class="chip num ${Math.abs(ds.amt - a) < 1e-9 ? 'on' : ''}" style="--accent:${def.c || '#40c8e0'}" data-act="ds-amt" data-v="${a}">${u && a === u.amount ? '★ ' : ''}${fmtAmt(a, def.unit)}</button>`).join('')}</div>
        <div class="eyebrow" style="margin:16px 2px 8px">When</div>
        <div class="chips ds-when">${WHEN.map(([o, l]) => `<button class="chip ${ds.off === o ? 'on' : ''}" style="--accent:${def.c || '#40c8e0'}" data-act="ds-off" data-v="${o}">${l}</button>`).join('')}
          <input class="inp ds-in" type="time" data-ds-time aria-label="Time taken"></div>
        <button class="btn btn-prominent block ds-go" style="margin-top:16px;--accent:${def.c || '#40c8e0'}" data-act="ds-log" data-ds-btn>${esc(logLabel(def))}</button>`;
      H0 += `<div class="stat3" style="margin-top:16px"><div class="frost"><div class="v num">${fmtAmt(todayAmt, '')}</div><div class="k">Today · ${esc(def.unit)}</div></div>
        <div class="frost"><div class="v num">${def.limit ? 'max ' + (def.goal || 0) : fmtAmt(def.goal, '')}</div><div class="k">${def.limit ? 'Limit' : 'Daily goal'}</div></div>
        <div class="frost"><div class="v num" style="${saf ? 'color:' + (saf.level === 'over' ? '#ff453a' : '#ffb340') : ''}">${saf ? fmtAmt(saf.ul, '') : '—'}</div><div class="k">Upper limit</div></div></div>`;
      if (mine.length) H0 += `<div class="grp-h">Today</div><section class="list frost">${mine.map(x => `<div class="li"><span class="tx"><div class="tt num">${fmtAmt(x.amount, def.unit)}</div><div class="st">${hm(Date.parse(x.at))}${pend.has(x.id) ? ' · not synced yet' : ''}</div></span>
        <button class="circle sm" data-act="ds-del" data-id="${esc(x.id)}" aria-label="Delete the ${hm(Date.parse(x.at))} dose">${icon('trash', 15)}</button></div>`).join('')}</section>`;
      if (S) {
        H0 += `<section class="card frost pk-now" style="margin-top:16px"><div class="eyebrow">Estimated now</div><div class="pk-big">${esc(S.line)}</div>
          ${S.sub ? `<div class="sub">${esc(S.sub)}</div>` : ''}
          ${S.recent && S.P.curve.some(p => p.v > 0) && sp.where !== 'gut' ? `<div style="margin-top:10px">${curveSvg(S.P)}</div>
            <div class="row num sub" style="gap:14px;margin-top:4px;font-size:.78rem">${dosed && S.P.peakAt ? `<span>${S.P.peakAt < Date.now() ? 'Peaked' : 'Peaks'} ~${hm(S.P.peakAt)}</span>` : ''}${dosed && S.P.clearAt ? `<span>Clears ~${hm(S.P.clearAt)}</span>` : ''}${S.P.pending > 0.01 ? `<span>${fmtAmt(S.P.pending, sp.mass)} still absorbing</span>` : ''}</div>` : ''}
          ${S.store ? `<div class="pk-store"><span>${esc(S.store.label)}</span><b style="${S.store.color ? 'color:' + S.store.color : ''}">${S.store.text ? esc(S.store.text) : esc(String(S.store.v)) + '<small> ' + esc(S.store.unit) + '</small>'}</b></div><div class="sub" style="line-height:1.45">${esc(S.store.note)}</div>${S.store.series ? storeSpark(S.store.series) : ''}` : ''}
          <p class="sub" style="margin:10px 0 0;line-height:1.45">Estimate from your dose times and population-average kinetics — people differ by ±30–50 %. Not a lab value.</p></section>`;
      }
      if (sp) H0 += `<div class="grp-h">How it works</div><section class="card frost tight pk-info"><p>${esc(sp.note)}</p><p><b>Timing</b> ${esc(sp.timing)}</p>
        ${def.inter && def.inter.note ? `<p><b>Interactions</b> ${esc(def.inter.note)}</p>` : ''}<p class="sub">Sources: ${esc(sp.src)}</p></section>`;
      return H0;
    },
  });
  return s;
}
function doseAt() {
  const tm = document.querySelector('[data-ds-time]')?.value;
  if (tm) {
    const [h, m] = tm.split(':').map(Number), d = new Date(); d.setHours(h, m, 0, 0);
    if (d.getTime() > Date.now() + 60e3) d.setDate(d.getDate() - 1);   // a time later than now means last night
    return d.getTime();
  }
  return Date.now() - ds.off * 60e3;
}
export const actions = {
  'dose-sheet'(d) { haptic(); doseSheet(d.k); },
  'dose-quick'(d) { logDose(d.k, Number(d.v), Date.now()); },
  'ds-amt'(d) { ds.amt = Number(d.v); ds.custom = ''; haptic(); topSheet()?.refresh(); },
  'ds-nudge'(d) { ds.amt = Math.max(0, Math.round((ds.amt + Number(d.d)) * 1000) / 1000); ds.custom = ''; haptic(); topSheet()?.refresh(); },
  'ds-off'(d) { ds.off = Number(d.v); topSheet()?.refresh(); },
  'ds-log'() {
    const raw = (document.querySelector('[data-ds-amt]')?.value || '').replace(',', '.').trim();
    const amt = raw ? Number(raw) : ds.amt;
    if (!(amt > 0 && amt < 100000)) { toast('Enter an amount'); return; }
    logDose(ds.k, amt, doseAt());
    ds.amt = amt; ds.custom = ''; const t = document.querySelector('[data-ds-time]'); if (t) t.value = '';
  },
  'ds-del'(d) {
    const ev = state.pending.find(e => !e.seq && e.type === 'dose.add' && e.data.dose && e.data.dose.id === d.id);
    if (ev) { dropPending(ev.id); toast('Dose removed'); return; }
    emitUndoable('dose.del', { id: d.id }, 'Dose deleted');
  },
};
/** The typed amount is the amount — and the Log button says so. */
export function onDoseInput(el) {
  ds.custom = el.value; el.style.width = inW(el.value);
  const n = Number(String(el.value).replace(',', '.'));
  if (el.value.trim() && n > 0 && isFinite(n)) ds.amt = n;
  const def = defOf(ds.k), b = document.querySelector('[data-ds-btn]');
  if (def && b) b.textContent = logLabel(def);
}
