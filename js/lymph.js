/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — the lymphatic system (logic/src/lymph.ts).

   An estimate of how well lymph is being moved today — from steps, lifting,
   breathing, salt, drinks, sleep and body fat — drawn on the body figure as
   node groups and vessels (the LYMPH overlay), with brain drainage shown
   apart because that science is genuinely disputed. The evidence is Bruno's
   own research vault; the myths and red flags come from the same notes.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, esc, today, haptic } from './core.js';
import { bioPatch } from './views.js';

let key = '', cache = null;
export function lymphNow(v = view()) {
  const k = (v.rev || 0) + ':' + state.pending.length + ':' + today();
  if (cache && key === k) return cache;
  const p = v.profile || {};
  cache = L.lymphReport({ today: today(), bio: v.bio || {}, sessions: v.workouts || [], doses: v.doses || [],
    bodyfat: p.bodyfat || null, sex: p.sex || null, inflammation: v.endo && v.endo.infl != null ? v.endo.infl : null });
  key = k; return cache;
}
/** Region score for a muscle — the LYMPH overlay's colour. */
export function lymphZone(v, slug) { const R = lymphNow(v), r = L.regionOfSlug(slug); return r && R.known ? String(R.regions[r]) : null; }
export function lymphSummary(v) {
  const R = lymphNow(v);
  return R.known ? 'pump ' + R.pump + ' · fluid load ' + R.load + ' · ' + R.balance.title.toLowerCase() : 'log steps to start';
}

/* the node layer — built once into the figure, shown in LYMPH mode */
export function lymphLayer(face) {
  const M = L.LYMPH_MAP[face], off = face === 'back' ? 0 : 0;
  return `<g class="lymph-layer" aria-hidden="true">${M.vessels.map(s => `<path class="lv" data-r="${s.region}" d="${s.d}" transform="translate(${off},0)"/>`).join('')}
    ${M.nodes.map(n => `<circle class="ln-glow" data-r="${n.region}" cx="${n.x}" cy="${n.y}" r="${n.r * 2.2}"/><circle class="ln" data-r="${n.region}" cx="${n.x}" cy="${n.y}" r="${n.r}"/>`).join('')}</g>`;
}
/** Brightness of each region's vessels and nodes. */
export function paintLymph(figEl, v) {
  if (!figEl) return;
  const R = lymphNow(v);
  figEl.querySelectorAll('.lymph-layer [data-r]').forEach(el => {
    // unknown (no steps yet) stays dim and even — never a guessed brightness
    const s = R.known ? (R.regions[el.dataset.r] ?? 50) : 20, a = (0.25 + s / 100 * 0.75).toFixed(2);
    el.style.opacity = a;
  });
}

const EV = { A: ['Strong', '#30d158'], B: ['Good', '#40c8e0'], C: ['Early', '#ffb340'] };
const PUFF = ['None', 'Mild', 'Noticeable', 'Marked'];
const card = (inner, cls = '') => `<section class="card frost ${cls}">${inner}</section>`;

export function secLymph(v) {
  const R = lymphNow(v), t = today(), puff = ((v.bio || {})[t] || {}).puff;
  const reg = Object.keys(L.LYMPH_REGIONS).map(k => `<div class="ly-reg"><span>${esc(L.LYMPH_REGIONS[k].name)}</span>
    <span class="ly-t"><i style="width:${R.regions[k]}%"></i></span><b class="num">${R.regions[k]}</b></div>`).join('');
  let H = `<div class="sim slim"><span>ⓘ</span><div>An estimate from how you moved, ate and slept — lymph flow cannot be measured at home. Switch the figure to <b>Lymph</b> to see the node groups.</div></div>`;
  H += card(R.known ? `<div class="ly-hero">
      <div><div class="v num" style="color:#40c8e0">${R.pump}</div><div class="k">Lymph pump</div></div>
      <div><div class="v num" style="color:${R.load >= 55 ? '#ff9f0a' : R.load >= 42 ? '#ffd60a' : '#30d158'}">${R.load}</div><div class="k">Fluid load</div></div></div>
      <div class="ly-bal" style="border-color:${R.balance.color}"><b style="color:${R.balance.color}">${esc(R.balance.title)}</b><span>${esc(R.balance.text)}</span></div>
      <div class="ly-regs">${reg}</div>`
    : `<div class="empty" style="padding:6px">Steps are the pump — once steps arrive (Apple Health or logged), the estimate starts.</div>`);
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Morning puffiness</h2><span class="k">teaches the model your pattern</span></div>`
    + card(`<div class="chips">${PUFF.map((l, i) => `<button class="chip ${puff === i ? 'on' : ''}" data-act="ly-puff" data-v="${i}">${l}</button>`).join('')}</div>
      <p class="sub" style="line-height:1.45;margin:8px 0 0">${R.puffiness.lines.length ? R.puffiness.lines.map(esc).join('<br>') : 'Rate your face and ankles on waking. After ' + Math.max(0, 8 - R.puffiness.n) + ' more mornings ARK shows what makes you puffy — drinks, salt or short nights.'}</p>`);
  const why = R.drivers.filter(d => d.area !== 'brain');
  if (why.length) H += `<div class="ba-h"><h2 style="font-size:1.05rem">Why</h2><span class="k">evidence grade · source</span></div>`
    + `<section class="list frost">${why.map(d => `<div class="li ly-d"><span class="tx"><div class="tt">${esc(d.label)}</div><div class="st">${esc(d.src)}</div></span>
      <span class="ly-ev" style="--c:${EV[d.ev][1]}">${EV[d.ev][0]}</span><b class="num" style="color:${d.d > 0 ? '#30d158' : '#ff9f0a'}">${d.d > 0 ? '+' : ''}${d.d}</b></div>`).join('')}</section>`;
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Do today</h2></div>` + card(`<ul class="ly-tips">${R.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
  const bd = R.drivers.filter(d => d.area === 'brain');
  H += `<div class="ba-h"><h2 style="font-size:1.05rem">Brain drainage</h2><span class="k ly-cont">contested science</span></div>`
    + card(R.brain.known ? `<div class="row"><div class="v num" style="font-size:1.6rem;font-weight:700;color:#bf5af2">${R.brain.score}</div>
        <p class="sub" style="flex:1;line-height:1.45;margin:0 0 0 12px">${esc(R.brain.note)} ${bd.map(d => esc(d.label)).join(' · ')}</p></div>`
      : `<p class="sub" style="margin:0;line-height:1.45">Needs last night's sleep. ${esc(R.brain.note)}</p>`);
  H += `<details class="adj"><summary>Myths — what does not move lymph</summary><section class="list frost">${L.LYMPH_MYTHS.map(m => `<div class="li"><span class="tx"><div class="tt">${esc(m[0])}</div><div class="st">${esc(m[1])}</div></span></div>`).join('')}</section></details>`;
  H += `<details class="adj"><summary>See a doctor if…</summary><ul class="ly-tips ly-red">${L.LYMPH_RED_FLAGS.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>`;
  return H;
}

export const actions = {
  'ly-puff'(d) { haptic(); bioPatch(today(), { puff: Number(d.v) }); },
};
