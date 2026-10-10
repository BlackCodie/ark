/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — doses and what they do over time (logic/src/pk.ts).

   Every supplement you log carries the time you took it. The kinetics model
   turns the doses into estimates: how much is circulating now (on top of the
   body's own baseline), when it peaks and clears, and — for things the body
   stores — how full the store is. These are population-average estimates of
   AMOUNTS, never lab measurements, and every screen says so.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, emit, emitUndoable, dropPending, esc, icon, today, fmt1, uid, toast, haptic, openSheet, topSheet, closeSheet } from './core.js';

const H = 3600e3;
const hm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
export const fmtAmt = (n, unit) => {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = a >= 1000 ? Math.round(n).toLocaleString() : a >= 100 ? String(Math.round(n)) : a >= 10 ? n.toFixed(1).replace(/\.0$/, '') : a >= 1 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, '');
  return s + (unit ? ' ' + unit : '');
};
export const doses = () => view().doses || [];
export const defOf = k => ((view().bioDefs || {}).micros || []).find(m => m.k === k) || null;
const dayOf = t => L.dayKey(new Date(t));

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
    out.line = extra >= sp.baseline * 0.005 ? `~${fmtAmt(extra, u)} extra in your blood from your doses` : 'Cleared — nothing extra circulating now';
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
    if (!any(90)) return null;
    const sat = L.creatineSaturation(days(90));
    return { label: 'Muscle creatine store', v: Math.round(sat * 100), unit: '% saturated', note: sat >= 0.95 ? 'Saturated — keep the daily dose to stay there.' : 'Fills faster with bigger daily doses; timing does not matter.' };
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
  const t0 = today(), cur = ((view().bio[t0] || {}).micros || {})[k] || 0;
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
export function doseSheet(k, preset) {
  const def = defOf(k); if (!def) return;
  ds = { k, amt: preset || (def.steps || [])[0] || def.goal || 1, off: 0, custom: '' };
  const s = openSheet({
    id: 'dose', title: def.icon + ' ' + def.name,
    render: () => {
      const v = view(), t = today(), S = standing(k), sp = S && S.sp;
      const todayAmt = ((v.bio[t] || {}).micros || {})[k] || 0;
      const saf = L.microSafety(k, todayAmt);
      const mine = doses().filter(x => x.k === k && dayOf(Date.parse(x.at)) === t).sort((a, b) => b.at.localeCompare(a.at));
      const dosed = doses().some(x => x.k === k && Date.now() - Date.parse(x.at) < 72 * 3600e3);
      const pend = new Set(state.pending.filter(e => !e.seq && e.type === 'dose.add').map(e => e.data.dose.id));
      let H0 = '';
      if (S) {
        H0 += `<section class="card frost pk-now"><div class="eyebrow">Estimated now</div><div class="pk-big">${esc(S.line)}</div>
          ${S.sub ? `<div class="sub">${esc(S.sub)}</div>` : ''}
          ${S.recent && S.P.curve.some(p => p.v > 0) && sp.where !== 'gut' ? `<div style="margin-top:10px">${curveSvg(S.P)}</div>
            <div class="row num sub" style="gap:14px;margin-top:4px;font-size:.78rem">${dosed && S.P.peakAt ? `<span>Peak ~${hm(S.P.peakAt)}</span>` : ''}${dosed && S.P.clearAt ? `<span>Clears ~${hm(S.P.clearAt)}</span>` : ''}${S.P.pending > 0.01 ? `<span>${fmtAmt(S.P.pending, sp.mass)} still absorbing</span>` : ''}</div>` : ''}
          ${S.store ? `<div class="pk-store"><span>${esc(S.store.label)}</span><b style="${S.store.color ? 'color:' + S.store.color : ''}">${S.store.text ? esc(S.store.text) : esc(String(S.store.v)) + '<small> ' + esc(S.store.unit) + '</small>'}</b></div><div class="sub" style="line-height:1.45">${esc(S.store.note)}</div>` : ''}
          <p class="sub" style="margin:10px 0 0;line-height:1.45">Estimate from your dose times and population-average kinetics — people differ by ±30–50 %. Not a lab value.</p></section>`;
      }
      H0 += `<div class="eyebrow" style="margin:16px 2px 8px">Log a dose</div>
        <div class="chips">${[...new Set([...(def.steps || []), def.goal].filter(x => x > 0))].map(a => `<button class="chip num ${ds.amt === a ? 'on' : ''}" data-act="ds-amt" data-v="${a}">${fmtAmt(a, def.unit)}</button>`).join('')}
          <input class="inp num ds-in" data-ds-amt inputmode="decimal" placeholder="Other" value="${esc(ds.custom)}" aria-label="Other amount in ${esc(def.unit)}"></div>
        <div class="eyebrow" style="margin:14px 2px 8px">When</div>
        <div class="chips">${[[0, 'Now'], [30, '30 min ago'], [60, '1 h ago'], [120, '2 h ago'], [240, '4 h ago']].map(([o, l]) => `<button class="chip ${ds.off === o ? 'on' : ''}" data-act="ds-off" data-v="${o}">${l}</button>`).join('')}
          <input class="inp ds-in" type="time" data-ds-time aria-label="Time taken"></div>
        <button class="btn btn-prominent block" style="margin-top:16px;--accent:${def.c || '#40c8e0'}" data-act="ds-log">Log ${esc(def.name)}</button>`;
      H0 += `<div class="stat3" style="margin-top:16px"><div class="frost"><div class="v num">${fmtAmt(todayAmt, '')}</div><div class="k">Today · ${esc(def.unit)}</div></div>
        <div class="frost"><div class="v num">${def.limit ? 'max ' + (def.goal || 0) : fmtAmt(def.goal, '')}</div><div class="k">${def.limit ? 'Limit' : 'Daily goal'}</div></div>
        <div class="frost"><div class="v num" style="${saf ? 'color:' + (saf.level === 'over' ? '#ff453a' : '#ffb340') : ''}">${saf ? fmtAmt(saf.ul, '') : '—'}</div><div class="k">Upper limit</div></div></div>`;
      if (mine.length) H0 += `<div class="grp-h">Today</div><section class="list frost">${mine.map(x => `<div class="li"><span class="tx"><div class="tt num">${fmtAmt(x.amount, def.unit)}</div><div class="st">${hm(Date.parse(x.at))}${pend.has(x.id) ? ' · not synced yet' : ''}</div></span>
        <button class="circle sm" data-act="ds-del" data-id="${esc(x.id)}" aria-label="Delete the ${hm(Date.parse(x.at))} dose">${icon('trash', 15)}</button></div>`).join('')}</section>`;
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
  'ds-amt'(d) { ds.amt = Number(d.v); ds.custom = ''; topSheet()?.refresh(); },
  'ds-off'(d) { ds.off = Number(d.v); topSheet()?.refresh(); },
  'ds-log'() {
    const raw = (document.querySelector('[data-ds-amt]')?.value || '').replace(',', '.').trim();
    const amt = raw ? Number(raw) : ds.amt;
    if (!(amt > 0 && amt < 100000)) { toast('Enter an amount'); return; }
    logDose(ds.k, amt, doseAt());
    ds.custom = ''; const t = document.querySelector('[data-ds-time]'); if (t) t.value = '';
  },
  'ds-del'(d) {
    const ev = state.pending.find(e => !e.seq && e.type === 'dose.add' && e.data.dose && e.data.dose.id === d.id);
    if (ev) { dropPending(ev.id); toast('Dose removed'); return; }
    emitUndoable('dose.del', { id: d.id }, 'Dose deleted');
  },
};
/** The "Other" amount field keeps its value across redraws. */
export function onDoseInput(el) { ds.custom = el.value; }
