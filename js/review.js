/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — the weekly review.
   One week of what actually happened, beside the week before. The numbers
   come from ARK_LOGIC.weeklyReview (logic/src/review.ts) — the same function
   your PC uses for the Sunday notification. A part with nothing logged says
   so; nothing is filled in to make the week look complete.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, esc, icon, today, shiftDay, fmt1, fmtDay, fmtMins, openSheet, topSheet, ringSvg } from './core.js';
import { systemReportHtml } from './system.js';

let which = 0;   // 0 = this week, 1 = last week

function reviewFor(back) {
  const v = view(), t = today();
  const start = shiftDay(L.weekStartOf(t), -7 * back);
  const names = Object.fromEntries((v.skills || []).map(s => [s.id, s.name]));
  const practice = (v.practiceLog || []).map(p => ({ skill: names[p.skill] || 'Practice', date: String(p.date || ''), mins: p.mins || 0 }));
  const until = back ? shiftDay(start, 6) : t;
  return L.weeklyReview({ workouts: v.workouts, habits: v.habits, habitLog: v.habitLog, weights: v.weights, practice, bio: v.bio, readiness: v.readiness }, start, until);
}
const pct = x => Math.round(x * 100);
function delta(cur, prev, fmt = x => String(x), unitWord = '') {
  if (prev === null || prev === undefined) return '';
  const d = cur - prev;
  if (Math.abs(d) < 1e-9) return `<span class="rv-d flat">same as the week before</span>`;
  return `<span class="rv-d ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${fmt(Math.abs(d))}${unitWord} vs the week before</span>`;
}

export function reviewSheet(back = 0) {
  which = back;
  openSheet({
    id: 'review', title: 'Your week',
    render: () => {
      const R = reviewFor(which), target = state.settings.weeklyWorkouts || 3;
      const range = `${fmtDay(R.start, { day: 'numeric', month: 'short' })} – ${fmtDay(shiftDay(R.start, 6), { day: 'numeric', month: 'short' })}`;
      let H = `<div class="seg" style="margin-bottom:12px"><button class="${which === 0 ? 'on' : ''}" data-act="review-week" data-b="0">This week</button>
        <button class="${which === 1 ? 'on' : ''}" data-act="review-week" data-b="1">Last week</button></div>
        <div class="sub" style="text-align:center;margin:-2px 0 14px">${range}${which === 0 ? ` · ${R.days} of 7 days so far` : ''}</div>`;
      if (which === 0) { try { H += systemReportHtml(R); } catch (e) { console.error('[report]', e); } }
      if (R.empty) return H + `<div class="card frost empty">Nothing was logged this week. One workout, one habit or one weigh-in and this page starts filling in — with your own numbers only.</div>`;

      const W = R.workouts;
      H += `<section class="card frost rv"><div class="rv-h"><span class="ic" style="--c:#ff9f0a">${icon('dumbbell', 18)}</span><b>Training</b></div>
        <div class="rv-big num">${W.n}<small> / ${target} workouts</small></div>
        ${W.n ? `<div class="sub">${W.sets} sets · ${W.volume.toLocaleString()} ${view().unit || 'kg'} lifted</div>` : '<div class="sub">No workouts logged this week.</div>'}
        ${delta(W.volume, W.prevN || W.prevVolume ? W.prevVolume : null, x => Math.round(x).toLocaleString(), ' ' + (view().unit || 'kg'))}
        ${R.prs.length ? `<div class="rv-prs">${R.prs.map(p => `<div class="rv-pr">${icon('trophy', 15)}<span>${esc(p.n)}</span><b class="num">${p.e1rm}</b><span class="sub">est. 1RM · was ${p.prev}</span></div>`).join('')}</div>` : ''}
      </section>`;

      if (R.habits) {
        const Hb = R.habits;
        H += `<section class="card frost rv"><div class="rv-h"><span class="ic" style="--c:#30d158">${icon('check', 18)}</span><b>Habits</b></div>
          <div class="row" style="gap:14px">${ringSvg(Hb.rate || 0, '#30d158', 64, 8, Hb.rate === null ? '—' : pct(Hb.rate) + '%')}
            <div style="flex:1;min-width:0"><div class="sub">${Hb.done} of ${Hb.possible} ticks</div>${Hb.rate !== null ? delta(pct(Hb.rate), Hb.prevRate === null ? null : pct(Hb.prevRate), x => x, ' pts') : ''}</div></div>
          ${Hb.best.length ? `<div class="rv-list"><div class="eyebrow">Held</div>${Hb.best.map(x => `<div>${esc(x.icon || '')} ${esc(x.name)} <span class="sub">· ${x.days} day${x.days === 1 ? '' : 's'}</span></div>`).join('')}</div>` : ''}
          ${Hb.slipped.length ? `<div class="rv-list"><div class="eyebrow">Not ticked this week</div>${Hb.slipped.map(x => `<div class="sub">${esc(x.icon || '')} ${esc(x.name)}</div>`).join('')}</div>` : ''}
        </section>`;
      }

      const bits = [];
      if (R.weight) bits.push(R.weight.delta === null
        ? `<div><div class="k">Weight</div><div class="v num">${fmt1(R.weight.last)}<small> kg</small></div><div class="sub">one weigh-in — the change shows from the next</div></div>`
        : `<div><div class="k">Weight</div><div class="v num">${R.weight.delta > 0 ? '+' : R.weight.delta < 0 ? '−' : '±'}${fmt1(Math.abs(R.weight.delta))}<small> kg</small></div>
        <div class="sub">${fmt1(R.weight.first)} → ${fmt1(R.weight.last)} · ${R.weight.n} weigh-in${R.weight.n === 1 ? '' : 's'}</div></div>`);
      if (R.sleep) bits.push(`<div><div class="k">Sleep</div><div class="v num">${fmt1(R.sleep.avg)}<small> h</small></div><div class="sub">average of ${R.sleep.n} night${R.sleep.n === 1 ? '' : 's'}</div></div>`);
      if (R.readiness) bits.push(`<div><div class="k">Readiness</div><div class="v num">${R.readiness.avg}</div><div class="sub">average of ${R.readiness.n} day${R.readiness.n === 1 ? '' : 's'}</div></div>`);
      if (R.practice.sessions) bits.push(`<div><div class="k">Practice</div><div class="v num">${fmtMins(R.practice.mins)}</div>
        <div class="sub">${R.practice.sessions} session${R.practice.sessions === 1 ? '' : 's'}${R.practice.top ? ' · most: ' + esc(R.practice.top.skill) : ''}</div>
        ${delta(R.practice.mins, R.practice.prevMins || null, x => fmtMins(x))}</div>`);
      if (bits.length) H += `<section class="card frost rv"><div class="rv-grid">${bits.join('')}</div></section>`;
      const missing = [!R.weight && 'weigh-ins', !R.sleep && 'sleep', !R.practice.sessions && 'practice'].filter(Boolean);
      if (missing.length) H += `<p class="sub" style="text-align:center;margin-top:12px;line-height:1.5">No ${missing.join(', ')} logged this week — those parts are left out rather than shown as zero.</p>`;
      return H;
    },
  });
}

export const actions = {
  'review-sheet'() { reviewSheet(0); },
  'review-week'(d) { which = Number(d.b); topSheet()?.refresh(); },
};
