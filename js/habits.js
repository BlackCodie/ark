/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — Habits, as boards. One coloured row per habit (seven bars for
   the week, a round check), a page per habit (heatmap, amount, streak,
   consistency, average, summary), analytics, check-ins and a journal.
   Check-ins carry a time, an optional amount and an optional note
   (logic/habitlog.ts, events habit.check / habit.uncheck); days ticked before
   check-ins existed count, with no time and no amount — nothing is invented.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, emit, changed, esc, icon, today, shiftDay, fmtDay, uid, toast, haptic, openSheet, closeSheet, topSheet, daysBetween } from './core.js';
import { habitEditSheet, habitNewSheet } from './more.js';

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const num = x => (Math.round(x * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
const colorOf = (h, i) => h.color || L.HABIT_COLORS[i % L.HABIT_COLORS.length];
const metaOf = h => ({ color: h.color, unit: h.unit || '', amin: h.amin, amax: h.amax, astep: h.astep });
const checksOf = (v, hid) => ((v.habitChecks || {})[hid] || []);
const doneOn = (v, hid, d) => !!(v.habitLog[d] && v.habitLog[d][hid]);
const hhmm = iso => { const t = new Date(iso); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
function dayLabel(d) {
  const t = today();
  if (d === t) return 'Today';
  if (d === shiftDay(t, -1)) return 'Yesterday';
  return fmtDay(d, { weekday: 'short', day: 'numeric', month: 'short' });
}
function relAgo(d) {
  const n = daysBetween(d, today());
  if (n <= 0) return 'today'; if (n === 1) return 'yesterday'; if (n < 14) return n + ' days ago';
  if (n < 60) return Math.round(n / 7) + ' weeks ago';
  if (n < 730) return Math.round(n / 30.4) + ' months ago';
  return Math.round(n / 365) + ' years ago';
}
let statsCache = new Map(), statsFor = null;
function statsOf(h) {
  const v = view();
  if (statsFor !== v) { statsCache = new Map(); statsFor = v; }
  if (!statsCache.has(h.id)) statsCache.set(h.id, L.habitStats(h.id, v.habitLog, v.habitChecks || {}, today(), metaOf(h)));
  return statsCache.get(h.id);
}

/* ══════════════ the board ══════════════ */
let pop = '';
export function renderBoards() {
  const v = view(), t = today();
  let H = `<header class="bd-top"><button class="circle glass" data-act="hb-menu" aria-label="More">${icon('dots', 20)}</button>
    <h1>Boards</h1><button class="circle glass" data-act="habit-new" aria-label="New habit">${icon('plus', 20, 2.2)}</button></header>`;
  if (!v.habits.length) return H + `<div class="card frost empty">No habits yet. Tap + to add one — it goes to ARK on your PC too.</div>`;
  H += `<div class="bd-list">` + v.habits.map((h, i) => {
    const c = colorOf(h, i), on = doneOn(v, h.id, t);
    const last = checksOf(v, h.id).filter(x => x.day === t && x.at).map(x => x.at).sort().pop();
    const bars = [6, 5, 4, 3, 2, 1, 0].map(k => { const d = shiftDay(t, -k), dn = doneOn(v, h.id, d); return `<i class="${dn ? 'on' : ''}${k === 0 ? ' t' : ''}"></i>`; }).join('');
    return `<div class="bd-row${on ? ' done' : ''}${pop === h.id ? ' pop' : ''}" style="--hc:${c}" data-act="hb-open" data-id="${esc(h.id)}" role="button" tabindex="0" aria-label="${esc(h.name)}">
      <span class="bd-ic">${esc(h.icon || '•')}</span>
      <span class="bd-tx"><b>${esc(h.name)}</b>${last ? `<small>${hhmm(last)}</small>` : ''}</span>
      <span class="bd-bars" aria-hidden="true">${bars}</span>
      <button class="bd-chk${on ? ' on' : ''}" data-act="hb-tick" data-id="${esc(h.id)}" aria-pressed="${on}" aria-label="${esc(h.name)} today">${on ? icon('tick', 22, 2.8) : '<i></i>'}</button>
    </div>`;
  }).join('') + `</div>`;
  pop = '';
  return H;
}

/* ══════════════ one habit ══════════════ */
let sel = { id: null, day: null };
function habit(id) { const v = view(); const i = v.habits.findIndex(x => x.id === id); return i < 0 ? null : { h: v.habits[i], i }; }
function dayAmount(v, h, d) {
  const cs = checksOf(v, h.id).filter(x => x.day === d);
  if (!cs.length) return doneOn(v, h.id, d) ? (h.unit ? null : 1) : 0;
  if (!h.unit) return cs.length;
  const a = cs.filter(x => x.amount != null);
  return a.length ? a.reduce((s, x) => s + x.amount, 0) : null;
}
function gauge(level) {
  const f = level === 'High' ? 0.82 : level === 'Average' ? 0.5 : level === 'Low' ? 0.2 : 0, r = 46, cx = 60, cy = 60;
  const arc = p => { const a = Math.PI * (1.15 - 1.3 * p), x = cx + r * Math.cos(a), y = cy - r * Math.sin(a); return [x.toFixed(1), y.toFixed(1)]; };
  const [x0, y0] = arc(0), [x1, y1] = arc(1), [xf, yf] = arc(f);
  return `<svg viewBox="0 0 120 90" class="hb-gauge" aria-hidden="true"><path d="M${x0} ${y0} A${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" stroke="var(--fill-3)" stroke-width="7" stroke-linecap="round"/>
    ${f ? `<path d="M${x0} ${y0} A${r} ${r} 0 ${f > 0.6 ? 1 : 0} 1 ${xf} ${yf}" fill="none" stroke="var(--hc)" stroke-width="7" stroke-linecap="round"/>` : ''}</svg>`;
}
export function habitPage(id) {
  const x = habit(id); if (!x) return;
  sel = { id, day: null };
  const sh = openSheet({
    id: 'hb-detail', full: true, title: (x.h.icon ? x.h.icon + ' ' : '') + x.h.name,
    left: `<button class="circle sm btn-glass" data-act="sheet-close" aria-label="Back"><span style="display:inline-flex;transform:rotate(180deg)">${icon('chev', 18)}</span></button>`,
    right: `<button class="circle sm btn-glass" data-act="habit-edit" data-id="${esc(id)}" aria-label="Edit habit">${icon('pencil', 16)}</button>`,
    render: () => pageHtml(),
  });
  if (sh && sh.el) sh.el.classList.add('hb-sheet');
}
function pageHtml() {
  const x = habit(sel.id); if (!x) return '<div class="empty">This habit is hidden or removed.</div>';
  const v = view(), h = x.h, c = colorOf(h, x.i), S = statsOf(h), t = today(), u = h.unit || '';
  const d = sel.day || (S.latest ? S.latest.day : t);
  const amt = dayAmount(v, h, d);
  const lo = h.amin != null ? h.amin : 0, hi = h.amax != null ? h.amax : 10, st = h.astep || (hi - lo <= 10 ? 0.5 : 1);
  const heat = `<div class="hb-heat"><div class="hb-wd">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(n => `<span>${n}</span>`).join('')}</div>
    <div class="hb-grid">${S.heatmap.map(col => `<div>${col.map(cell => `<button class="${cell.on ? 'on' : ''}${cell.day === d ? ' sel' : ''}${cell.future ? ' fut' : ''}" ${cell.future ? 'disabled' : `data-act="hb-day" data-day="${cell.day}"`} aria-label="${fmtDay(cell.day)}${cell.on ? ' — done' : ''}"></button>`).join('')}</div>`).join('')}</div></div>`;
  const amountRow = u ? `<div class="hb-amt"><div><div class="sub">${esc(dayLabel(d))}</div><div class="hb-amt-v num"><span data-hb-amtv>${amt == null ? (doneOn(v, h.id, d) ? '✓' : '—') : num(amt)}</span> <small>${esc(u)}</small></div></div>
      <div class="hb-slider"><div class="hb-sl-lbl"><span>${num(lo)}</span><span>${num(hi)}</span></div>
        <input type="range" min="${lo}" max="${hi}" step="${st}" value="${amt == null ? lo : Math.min(hi, Math.max(lo, amt))}" data-hb-amt aria-label="Amount for ${esc(dayLabel(d))}"></div></div>`
    : `<div class="hb-amt"><div><div class="sub">${esc(dayLabel(d))}</div><div class="hb-amt-v">${doneOn(v, h.id, d) ? 'Done' : 'Not done'}</div></div>
      <button class="btn sm ${doneOn(v, h.id, d) ? 'btn-glass' : 'btn-prominent'}" style="--accent:${c}" data-act="hb-toggle-day" data-day="${d}">${doneOn(v, h.id, d) ? 'Undo' : 'Check in'}</button></div>`;
  const wk = S.weekdayAvg, wmax = Math.max(1e-9, ...wk.map(z => z || 0));
  const avgCard = u ? `<section class="hb-card"><div class="hb-k">${icon('chart', 13)} AVERAGE AMOUNT</div>
      <div class="hb-bar"><i style="width:${S.avg == null || !hi ? 0 : Math.min(100, S.avg / hi * 100)}%"></i></div>
      <div class="hb-big num">${S.avg == null ? '—' : num(S.avg)} <small>${esc(u)}</small></div>
      <div class="hb-wk">${[6, 0, 1, 2, 3, 4, 5].map(i => `<span><i style="height:${wk[i] ? Math.max(3, wk[i] / wmax * 26) : 0}px"></i><b class="${i === (new Date().getDay() + 6) % 7 ? 'now' : ''}">${'SMTWTFS'[(i + 1) % 7]}</b></span>`).join('')}</div></section>`
    : `<section class="hb-card"><div class="hb-k">${icon('chart', 13)} CHECK-INS PER WEEK</div>
      <div class="hb-big num">${S.summary.first ? num(S.days / Math.max(1, Math.ceil((daysBetween(S.summary.first, t) + 1) / 7))) : '—'}</div>
      <div class="hb-wk">${[6, 0, 1, 2, 3, 4, 5].map(i => { const tot = S.weekdays.totals[i], mx = Math.max(1, ...S.weekdays.totals); return `<span><i style="height:${tot ? Math.max(3, tot / mx * 26) : 0}px"></i><b>${'SMTWTFS'[(i + 1) % 7]}</b></span>`; }).join('')}</div></section>`;
  const Sm = S.summary, row = (ic, k, val, sub) => `<div class="hb-sr"><span class="ic">${ic}</span><span class="tx">${k}${sub ? `<small>${esc(sub)}</small>` : ''}</span><b>${val}</b></div>`;
  const U = u ? ' ' + esc(u) : '';
  const summary = `<div class="hb-sh">Summary</div><section class="hb-sum">
    ${u ? row('🗓', 'Current month', Sm.monthTotal ? num(Sm.monthTotal) + U : '0' + U) : row('🗓', 'Current month', S.months[11].days + ' day' + (S.months[11].days === 1 ? '' : 's'))}
    ${u ? row('➗', 'Current month average', Sm.monthAvg == null ? '—' : num(Sm.monthAvg) + U) : ''}
    ${u ? row('Σ', 'Total tracked amount', num(Sm.total) + U) : ''}
    ${row('✓', 'Total check-ins', String(Sm.checkins))}
    ${row('▦', 'Tracked days', String(Sm.trackedDays))}
    ${Sm.first ? row('🏁', 'First check-in', relAgo(Sm.first), fmtDay(Sm.first, { day: 'numeric', month: 'long', year: 'numeric' })) : ''}
    ${Sm.latest ? row('🕘', 'Latest check-in', relAgo(Sm.latest), fmtDay(Sm.latest, { day: 'numeric', month: 'long', year: 'numeric' })) : ''}
    ${u && Sm.lowest ? row('↓', 'Lowest daily amount', num(Sm.lowest.v) + U, fmtDay(Sm.lowest.day, { day: 'numeric', month: 'long', year: 'numeric' })) : ''}
    ${u && Sm.highest ? row('↑', 'Highest daily amount', num(Sm.highest.v) + U, fmtDay(Sm.highest.day, { day: 'numeric', month: 'long', year: 'numeric' })) : ''}</section>`;
  return `<div class="hb-page" style="--hc:${c}">
    <section class="hb-hero">${heat}${amountRow}</section>
    <div class="hb-two"><section class="hb-card"><div class="hb-k">🔥 CURRENT STREAK</div><div class="hb-big num" style="color:var(--hc)">${S.current} <small>day${S.current === 1 ? '' : 's'}</small></div><div class="sub">Longest: <b>${S.longest}</b></div></section>
      <section class="hb-card hb-cons"><div class="hb-k">〰 CONSISTENCY</div>${gauge(S.consistency.level)}<b class="hb-cl">${S.consistency.level || '—'}</b></section></div>
    ${avgCard}${summary}
    <p class="sub" style="line-height:1.45;margin:10px 4px 90px">Consistency = weeks with at least one check-in over the last 8 weeks — regular beats daily. ${u ? 'Days ticked before amounts existed count as check-ins with no amount.' : 'Give this habit a unit (✎) to track an amount, like minutes.'}</p>
    <div class="hb-dock"><div class="hb-pill"><button data-act="hb-analytics" aria-label="Analytics">${icon('chart', 21)}</button><button data-act="hb-checkins" aria-label="Check-ins">${icon('check', 21)}</button><button data-act="hb-journal" aria-label="Journal">${icon('book', 21)}</button></div>
      <button class="hb-plus" data-act="hb-add" aria-label="Check in now">${icon('plus', 24, 2.4)}</button></div>
  </div>`;
}
/* the amount slider: the number follows your finger; letting go saves it to that day's check-in */
export function onHabitInput(el, commit) {
  if (!el.matches('[data-hb-amt]')) return false;
  const lbl = document.querySelector('[data-hb-amtv]'); if (lbl) lbl.textContent = num(Number(el.value));
  if (!commit) return true;
  const x = habit(sel.id); if (!x) return true;
  const v = view(), S = statsOf(x.h), d = sel.day || (S.latest ? S.latest.day : today());
  const cs = checksOf(v, x.h.id).filter(c => c.day === d).sort((a, b) => (a.at || '').localeCompare(b.at || ''));
  const prev = cs[cs.length - 1];
  const check = prev ? { ...prev, amount: Number(el.value) } : { id: 'hc' + uid(), habit: x.h.id, day: d, at: d === today() ? new Date().toISOString() : null, amount: Number(el.value) };
  emit('habit.check', { check }); haptic();
  return true;
}

/* ══════════════ analytics ══════════════ */
function lineChart(vals, labels, c, max) {
  const W = 300, H = 120, n = vals.length, m = max || Math.max(1, ...vals.map(z => z || 0)), x = i => 20 + i * (W - 40) / Math.max(1, n - 1), y = z => H - 18 - (z / m) * (H - 34);
  const pts = vals.map((z, i) => z == null ? null : [x(i), y(z)]);
  let path = '', open = false;
  pts.forEach(p => { if (!p) { open = false; return; } path += (open ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); open = true; });
  return `<svg viewBox="0 0 ${W} ${H}" class="hb-chart" preserveAspectRatio="none">${[0, 0.5, 1].map(f => `<line x1="20" x2="${W - 20}" y1="${y(m * f)}" y2="${y(m * f)}" class="gl"/><text x="${W - 4}" y="${y(m * f) + 3}" class="ax" text-anchor="end">${num(m * f)}</text>`).join('')}
    <path d="${path}" fill="none" stroke="${c}" stroke-width="2.4" stroke-linejoin="round"/>${pts.map(p => p ? `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="var(--bg,#000)" stroke="${c}" stroke-width="2.2"/>` : '').join('')}
    ${labels.map((l, i) => `<text x="${x(i)}" y="${H - 3}" class="ax" text-anchor="middle">${l}</text>`).join('')}</svg>`;
}
function barChart(vals, labels, c, prev) {
  const W = 300, H = 120, n = vals.length, m = Math.max(1, ...vals, ...(prev || [])), bw = (W - 40) / n;
  return `<svg viewBox="0 0 ${W} ${H}" class="hb-chart" preserveAspectRatio="none">${[0, 0.5, 1].map(f => `<line x1="20" x2="${W - 20}" y1="${H - 18 - f * (H - 34)}" y2="${H - 18 - f * (H - 34)}" class="gl"/>`).join('')}
    ${vals.map((z, i) => { const hh = z / m * (H - 34), ph = prev ? prev[i] / m * (H - 34) : 0;
      return `${prev && ph ? `<rect x="${20 + i * bw + bw * 0.18}" y="${H - 18 - ph}" width="${bw * 0.28}" height="${ph}" rx="2" fill="var(--t4)"/>` : ''}<rect x="${20 + i * bw + bw * (prev ? 0.5 : 0.25)}" y="${H - 18 - hh}" width="${bw * (prev ? 0.32 : 0.5)}" height="${hh}" rx="2" fill="${c}"/>`; }).join('')}
    ${labels.map((l, i) => `<text x="${20 + i * bw + bw / 2}" y="${H - 3}" class="ax" text-anchor="middle">${l}</text>`).join('')}</svg>`;
}
function analyticsSheet(id) {
  const x = habit(id); if (!x) return;
  const c = colorOf(x.h, x.i);
  openSheet({
    id: 'hb-analytics', title: 'Analytics',
    render: () => {
      const S = statsOf(x.h), u = x.h.unit || '', Y = S.years, mo = S.months, mlab = mo.map(m => MONTHS[+m.ym.slice(5) - 1]);
      const lvl = l => (l === 'High' ? 3 : l === 'Average' ? 2 : l === 'Low' ? 1 : null);
      const tot = S.weekdays.totals, tmax = Math.max(...tot), tmin = Math.min(...tot.filter(z => z > 0).concat([tmax]));
      const donut = (() => { const p = S.weekdays.workdays / 100, r = 34, C = 2 * Math.PI * r; return `<svg viewBox="0 0 90 90" class="hb-donut"><circle cx="45" cy="45" r="${r}" fill="none" stroke="var(--fill-3)" stroke-width="14"/>
        <circle cx="45" cy="45" r="${r}" fill="none" stroke="var(--t3)" stroke-width="14" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 45 45)"/></svg>`; })();
      // streaks: one row per month (last 12), a segment per run
      const rows = mo.map(m => { const days = new Date(+m.ym.slice(0, 4), +m.ym.slice(5), 0).getDate();
        const segs = S.streaks.filter(s => s.start.slice(0, 7) <= m.ym && s.end.slice(0, 7) >= m.ym).map(s => {
          const a = s.start.slice(0, 7) < m.ym ? 1 : +s.start.slice(8), b = s.end.slice(0, 7) > m.ym ? days : +s.end.slice(8);
          return `<i class="${s.len === S.longest && S.longest > 1 ? 'top' : ''}" style="left:${(a - 1) / 31 * 100}%;width:${Math.max(1.6, (b - a + 1) / 31 * 100)}%"></i>`; }).join('');
        return `<div class="hb-st-r"><span>${MON3[+m.ym.slice(5) - 1]}</span><div>${segs}</div></div>`; }).join('');
      return `<div class="hb-an" style="--hc:${c}">
        <section class="hb-card"><div class="hb-k">${icon('chart', 13)} TIMELINE <span>${u ? 'Total amounts' : 'Check-ins'} over time · ${Y.year}</span></div>${lineChart(Y.months.map((z, i) => { const ym = Y.year + '-' + String(i + 1).padStart(2, '0'); return ym > today().slice(0, 7) || (S.summary.first && ym < S.summary.first.slice(0, 7)) ? null : z; }), MONTHS, c)}</section>
        <div class="hb-sh">Weekdays <small>${u ? 'Total amounts' : 'Check-ins'} by day of the week, past 12 months</small></div>
        <section class="hb-card hb-wds">${donut}<div class="hb-leg"><span><i style="background:var(--t3)"></i>Workdays <b>${S.weekdays.workdays} %</b></span><span><i style="background:var(--fill-3)"></i>Weekends <b>${S.weekdays.weekends} %</b></span></div>
          <div class="hb-wdb">${tot.map((z, i) => `<span><em>${z === tmax && z > 0 ? '↑' : z === tmin && z > 0 && tmin !== tmax ? '↓' : ''}</em><i style="height:${tmax ? Math.max(z ? 4 : 0, z / tmax * 56) : 0}px"></i><b>${WD[i]}</b></span>`).join('')}</div></section>
        <section class="hb-card"><div class="hb-k">▥ YEAR COMPARISON <span>Monthly ${u ? 'totals' : 'check-ins'}, ${Y.year}${Y.prev ? ' vs ' + (Y.year - 1) : ''}</span></div>${barChart(Y.months, MONTHS, c, Y.prev)}</section>
        <section class="hb-card"><div class="hb-k">〰 CONSISTENCY <span>Monthly, past 12 months</span></div>${lineChart(mo.map(m => lvl(m.level)), mlab, c, 3)}<div class="hb-lv"><span>High</span><span>Average</span><span>Low</span></div></section>
        ${u ? `<section class="hb-card"><div class="hb-k">↕ AMOUNT RANGES <span>Daily amounts, past 12 months</span></div>${(() => { const mx = Math.max(1, ...mo.map(m => m.max || 0));
          return `<svg viewBox="0 0 300 120" class="hb-chart" preserveAspectRatio="none">${mo.map((m, i) => { if (m.min == null) return ''; const xx = 20 + i * 260 / 11, y1 = 102 - m.max / mx * 86, y0 = 102 - m.min / mx * 86;
            return `<rect x="${xx - 4}" y="${y1}" width="8" height="${Math.max(8, y0 - y1)}" rx="4" fill="${c}"/>`; }).join('')}${mlab.map((l, i) => `<text x="${20 + i * 260 / 11}" y="117" class="ax" text-anchor="middle">${l}</text>`).join('')}</svg>`; })()}</section>` : ''}
        <section class="hb-card"><div class="hb-k">🕘 TIME OF DAY <span>When you checked in, past 12 months${S.times.length ? '' : ' — no times yet'}</span></div>
          <svg viewBox="0 0 300 160" class="hb-chart" preserveAspectRatio="none">${['00:00', '06:00', '12:00', '18:00', '23:59'].map((l, i) => `<line x1="20" x2="262" y1="${144 - i * 34}" y2="${144 - i * 34}" class="gl"/><text x="298" y="${147 - i * 34}" class="ax" text-anchor="end">${l}</text>`).join('')}
          ${S.times.map(p => { const mi = mo.findIndex(m => m.ym === p.day.slice(0, 7)); return mi < 0 ? '' : `<circle cx="${20 + mi * 242 / 11}" cy="${144 - p.minutes / 1440 * 136}" r="4" fill="${c}"/>`; }).join('')}
          ${mlab.map((l, i) => `<text x="${20 + i * 242 / 11}" y="158" class="ax" text-anchor="middle">${l}</text>`).join('')}</svg></section>
        <section class="hb-card"><div class="hb-k">🔥 STREAKS <span>Past 12 months</span></div><div class="hb-st">${rows}</div><div class="sub" style="margin-top:8px"><i class="hb-dot"></i> Longest streak – ${S.longest} day${S.longest === 1 ? '' : 's'}</div></section>
      </div>`;
    },
  });
}

/* ══════════════ check-ins & journal ══════════════ */
function allCheckins(h) { const v = view(); return L.checkinsOf(h.id, v.habitLog, v.habitChecks || {}).slice().reverse(); }
function checkinsSheet(id) {
  const x = habit(id); if (!x) return;
  openSheet({
    id: 'hb-checkins', title: 'Check-ins',
    right: `<button class="circle sm btn-glass" data-act="hb-new-check" aria-label="Add a check-in">${icon('plus', 18, 2.2)}</button>`,
    render: () => {
      const C = allCheckins(x.h), u = x.h.unit || '';
      if (!C.length) return '<div class="empty">No check-ins yet.</div>';
      let H = '', mo = '', dd = '';
      C.forEach(c => {
        const m = MON3[+c.day.slice(5, 7) - 1] + ' ' + c.day.slice(0, 4);
        if (m !== mo) { H += `${mo ? '</section>' : ''}<div class="hb-mo"><b>${fmtDay(c.day, c.day.slice(0, 4) === today().slice(0, 4) ? { month: 'long' } : { month: 'long', year: 'numeric' })}</b><span class="hb-n">${C.filter(z => z.day.slice(0, 7) === c.day.slice(0, 7)).length}</span></div><section>`; mo = m; dd = ''; }
        if (c.day !== dd) { H += `<div class="hb-dd"><span>${fmtDay(c.day, { month: 'short', day: 'numeric' })}</span><span class="hb-n">${C.filter(z => z.day === c.day).length}</span></div>`; dd = c.day; }
        H += `<button class="hb-ci" ${c.id ? `data-act="hb-edit-check" data-cid="${esc(c.id)}"` : 'disabled'}><span>${esc(x.h.icon || '•')}</span><span>${c.at ? hhmm(c.at) : 'no time'}</span>${c.amount != null && u ? `<span class="sub">${num(c.amount)} ${esc(u)}</span>` : ''}${c.note ? `<span class="sub">${icon('note', 13)}</span>` : ''}<span class="ok">✓</span></button>`;
      });
      return H + '</section><p class="sub" style="margin-top:12px;line-height:1.45">Days ticked before check-ins had times show “no time”.</p>';
    },
  });
}
let ce = null;
function checkEditSheet(id, cid) {
  const x = habit(id); if (!x) return;
  const v = view(), c0 = cid ? checksOf(v, id).find(c => c.id === cid) : null;
  const now = new Date();
  ce = c0 ? { ...c0 } : { id: 'hc' + uid(), habit: id, day: today(), at: now.toISOString(), amount: x.h.unit ? (x.h.amin != null ? x.h.amin : 1) : null, note: '' };
  const t0 = ce.at ? hhmm(ce.at) : '';
  openSheet({
    id: 'hb-check', title: c0 ? 'Check-in' : 'New check-in',
    render: () => `<label class="field"><span>Day</span><input class="inp" type="date" max="${today()}" value="${esc(ce.day)}" data-ce="day"></label>
      <label class="field"><span>Time</span><input class="inp" type="time" value="${esc(t0)}" data-ce="time"></label>
      ${x.h.unit ? `<label class="field"><span>Amount (${esc(x.h.unit)})</span><input class="inp" inputmode="decimal" value="${ce.amount == null ? '' : esc(String(ce.amount))}" data-ce="amount"></label>` : ''}
      <label class="field"><span>Note</span><textarea class="inp" rows="3" maxlength="500" data-ce="note" placeholder="Optional — goes to the Journal">${esc(ce.note || '')}</textarea></label>
      <button class="btn btn-prominent block" style="--accent:${colorOf(x.h, x.i)}" data-act="hb-save-check">Save</button>
      ${c0 ? `<button class="btn btn-danger block" style="margin-top:10px" data-act="hb-del-check" data-cid="${esc(c0.id)}">${icon('trash', 16)} Delete check-in</button>` : ''}`,
  });
}
function journalSheet(id) {
  const x = habit(id); if (!x) return;
  let q = '';
  const s = openSheet({
    id: 'hb-journal', title: 'Journal',
    render: () => {
      const notes = allCheckins(x.h).filter(c => c.note && (!q || c.note.toLowerCase().includes(q)));
      return `<input class="inp" type="search" placeholder="Search" data-hb-jq value="${esc(q)}" style="margin-bottom:12px">` + (notes.length
        ? `<section class="list frost">${notes.map(c => `<button class="li" data-act="hb-edit-check" data-cid="${esc(c.id)}"><span class="tx"><div class="tt">${esc(c.note)}</div><div class="st">${fmtDay(c.day, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${c.at ? ' · ' + hhmm(c.at) : ''}</div></span></button>`).join('')}</section>`
        : `<div class="empty" style="padding:40px 10px">${icon('book', 40)}<br><b>Journal</b><br>Notes you add to check-ins on this habit${q ? ' — none match' : ''}.</div>`);
    },
  });
  s.search = val => { q = val.trim().toLowerCase(); s.refresh(); const i = document.querySelector('[data-hb-jq]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } };
}
export function onHabitSearch(el) {
  if (!el.matches('[data-hb-jq]')) return false;
  const s = topSheet(); if (s && s.search) s.search(el.value);
  return true;
}

/* ══════════════ the menu ══════════════ */
function menuSheet() {
  openSheet({
    id: 'hb-menu', title: 'Boards',
    render: () => {
      const hid = view().habitsHidden || [];
      return `<section class="list frost"><button class="li" data-act="habit-new"><span class="ic" style="--c:#30d158">${icon('plus', 18)}</span><span class="tx"><div class="tt">New habit</div></span></button>
        <button class="li" data-act="sync-sheet"><span class="ic" style="--c:#0a84ff">${icon('sync', 18)}</span><span class="tx"><div class="tt">Sync with your PC</div></span></button></section>
        ${hid.length ? `<div class="grp-h">Hidden (${hid.length})</div><section class="list frost">${hid.map(h => `<div class="li"><span class="ic">${esc(h.icon || '•')}</span>
          <span class="tx"><div class="tt">${esc(h.name)}</div><div class="st">Not counted · history kept</div></span>
          <button class="btn sm btn-glass" data-act="habit-unhide" data-id="${esc(h.id)}">Show</button></div>`).join('')}</section>` : ''}
        <p class="sub" style="line-height:1.5;margin-top:12px">Tap a habit for its page. The circle ticks today; tap again to undo.</p>`;
    },
  });
}

export const actions = {
  'hb-open'(d) { habitPage(d.id); },
  'hb-tick'(d) {
    const v = view(), t = today(), x = habit(d.id); if (!x) return;
    if (doneOn(v, d.id, t)) { emit('habit.set', { day: t, habit: d.id, done: false }); haptic(); return; }
    const last = checksOf(v, d.id).filter(c => c.amount != null).pop();
    const amount = x.h.unit ? (last ? last.amount : (x.h.amin != null ? x.h.amin : null)) : null;
    emit('habit.check', { check: { id: 'hc' + uid(), habit: d.id, day: t, at: new Date().toISOString(), amount } });
    pop = d.id; haptic();
  },
  'hb-day'(d) { sel.day = d.day; const s = topSheet(); if (s && s.id === 'hb-detail') s.refresh(); },
  'hb-toggle-day'(d) {
    const v = view();
    if (doneOn(v, sel.id, d.day)) emit('habit.set', { day: d.day, habit: sel.id, done: false });
    else emit('habit.check', { check: { id: 'hc' + uid(), habit: sel.id, day: d.day, at: d.day === today() ? new Date().toISOString() : null } });
    haptic();
  },
  'hb-add'() { checkEditSheet(sel.id, null); },
  'hb-analytics'() { analyticsSheet(sel.id); },
  'hb-checkins'() { checkinsSheet(sel.id); },
  'hb-journal'() { journalSheet(sel.id); },
  'hb-new-check'() { checkEditSheet(sel.id, null); },
  'hb-edit-check'(d) { checkEditSheet(sel.id, d.cid); },
  'hb-save-check'() {
    const g = k => document.querySelector('[data-ce="' + k + '"]');
    const day = (g('day') && g('day').value) || today(), tm = g('time') && g('time').value;
    if (day > today()) { toast('That day has not happened yet'); return; }
    let at = null;
    if (tm) { const [hh, mm] = tm.split(':').map(Number); at = new Date(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10), hh, mm).toISOString(); }
    const raw = g('amount') ? g('amount').value.replace(',', '.').trim() : '';
    const check = { id: ce.id, habit: ce.habit, day, at, amount: raw === '' ? null : Number(raw), note: g('note') ? g('note').value : '' };
    if (raw !== '' && !(check.amount >= 0)) { toast('Amount must be a number'); return; }
    // A check-in moved to another day is a new one there.
    if (view().habitChecks && checksOf(view(), ce.habit).some(c => c.id === ce.id) && ce.day !== day) { emit('habit.uncheck', { id: ce.id }); check.id = 'hc' + uid(); }
    emit('habit.check', { check }); closeSheet(topSheet()); haptic(); toast('Saved');
  },
  'hb-del-check'(d) {
    if (!confirm('Delete this check-in?')) return;
    emit('habit.uncheck', { id: d.cid }); closeSheet(topSheet()); haptic();
  },
  'hb-menu'() { menuSheet(); },
};
export { habitEditSheet, habitNewSheet };
