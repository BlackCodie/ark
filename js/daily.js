/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — fuel and the Apple Health link.

   Fuel: saved meals logged with one tap (logic/src/fuel.ts). Each logged meal
   adds its protein and calories to the day under its own id, so Undo or ✕
   takes back exactly that.

   The Apple Health link: an iOS Shortcut opens
   https://blackcodie.github.io/ark/#health=<the day's values>. This page reads
   them (healthPatches — the same mapping the PC uses), queues one
   `health.import` event and syncs it through GitHub, so it works anywhere,
   with the PC off. Nothing is read from Health by the web app itself — iOS
   does not allow that; the Shortcut does the reading.
   ══════════════════════════════════════════════════════════════════════ */
import {
  L, state, view, emit, emitUndoable, dropPending, changed, esc, icon, today, fmt1, haptic, toast, openSheet, topSheet, closeSheet, syncNow,
} from './core.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ── fuel ── */
export function fuelCard(v = view()) {
  const t = today(), goals = ((v.bioDefs || {}).goals) || {};
  const F = L.fuelDay((v.bio || {})[t], { prot: goals.prot, cal: goals.cal });
  const meals = L.mealsByUse(v.meals || [], v.bio || {});
  const bar = (lbl, val, goal, unit, col) => `<div class="fu-row"><div class="fu-l"><b>${lbl}</b><span class="num">${val}${goal ? ' / ' + goal : ''} ${unit}${goal && val < goal ? ' · ' + (goal - val) + ' to go' : goal ? ' ✓' : ''}</span></div>
    <div class="fu-t"><i style="width:${goal ? Math.min(100, Math.round(val / goal * 100)) : 0}%;background:${col}"></i></div></div>`;
  return `<section class="card frost fuel"><div class="q-h"><span>🍽</span><b>Fuel</b>${meals.length ? '<button class="link" data-act="meal-manage">Edit</button>' : ''}<button class="link" data-act="meal-new">${icon('plus', 14)} Meal</button></div>
    ${bar('Protein', F.prot, F.protGoal, 'g', '#30d158')}${bar('Calories', F.cal, F.calGoal, 'kcal', '#ff9f0a')}
    ${meals.length ? `<div class="chips fu-chips">${meals.map(m => `<button class="chip" data-act="meal-eat" data-id="${esc(m.id)}">${esc(m.name)} <small>${m.prot} g</small></button>`).join('')}</div>`
      : `<p class="sub" style="margin:8px 0 0;line-height:1.45">Save the meals you eat often — then one tap logs their protein and calories.</p>`}
    ${F.meals.length ? `<div class="fu-today">${F.meals.map(e => `<span>${esc(e.name)}<button data-act="meal-uneat" data-eid="${esc(e.eid)}" aria-label="Remove ${esc(e.name)}">✕</button></span>`).join('')}</div>` : ''}</section>`;
}
let mealDraft = null;
function mealSheet(edit) {
  mealDraft = edit ? { ...edit } : { id: 'meal' + uid(), name: '', prot: '', cal: '', save: true };
  openSheet({
    id: 'meal', title: edit ? 'Edit meal' : 'New meal',
    render: () => `<label class="field"><span>Name</span><input class="inp" maxlength="60" placeholder="Usual breakfast" value="${esc(mealDraft.name)}" data-meal="name"></label>
      <div class="grid2"><label class="field"><span>Protein (g)</span><input class="inp num" type="number" inputmode="decimal" min="0" max="300" value="${esc(mealDraft.prot)}" data-meal="prot"></label>
        <label class="field"><span>Calories (kcal)</span><input class="inp num" type="number" inputmode="decimal" min="0" max="5000" value="${esc(mealDraft.cal)}" data-meal="cal"></label></div>
      ${edit ? `<button class="btn btn-prominent block" data-act="meal-save" data-eat="0">Save</button>
          <button class="btn btn-glass block" style="margin-top:10px" data-act="meal-del">Delete this meal</button>`
        : `<button class="btn btn-prominent block" data-act="meal-save" data-eat="1">Save &amp; log now</button>
          <button class="btn btn-glass block" style="margin-top:10px" data-act="meal-once">Log once, don't save</button>`}`,
  });
  setTimeout(() => document.querySelector('[data-meal="name"]')?.focus(), 400);
}
function mealRead() {
  const g = k => document.querySelector('[data-meal="' + k + '"]');
  ['name', 'prot', 'cal'].forEach(k => { if (g(k)) mealDraft[k] = g(k).value; });
}
function eat(m) {
  const item = { eid: 'm' + uid(), id: m.id, name: m.name, prot: m.prot, cal: m.cal, at: new Date().toISOString() };
  emitUndoable('meal.eat', { day: today(), item }, '🍽 ' + m.name + ' — +' + m.prot + ' g protein');
}

/* ── the Apple Health link ── */
export function importHealthLink(raw) {
  const payload = L.parseHealthHash(raw);
  try { history.replaceState(null, '', location.pathname + location.search + location.hash.replace(/[#&]health=[^&]*/, '').replace(/^&/, '#')); } catch (e) { /* keep going */ }
  if (!payload) { toast('That Apple Health link could not be read'); return; }
  const P = L.healthPatches(payload, new Date());
  const n = P.reduce((a, p) => a + Object.keys(p.fields).length + (p.weightKg !== null ? 1 : 0), 0);
  if (!n) { toast('The Shortcut sent no values ARK can use'); return; }
  if (!state.token) {
    openSheet({ id: 'health-link', title: 'Apple Health', render: () => `<p style="line-height:1.5">This browser is not connected to ARK yet, so it cannot send what the Shortcut read.</p>
      <p class="sub" style="line-height:1.5">Do it once: on your PC open ARK → 📱 Phone, and scan the QR with the iPhone <b>Camera</b> (it opens here, in Safari). The next morning's Shortcut then goes through by itself.</p>
      <button class="btn btn-prominent block" data-act="pair-scan">${icon('camera', 16)} Scan the QR here</button>` });
    return;
  }
  emit('health.import', { payload });
  state.healthLink = { ts: new Date().toISOString(), n };
  syncNow();
  const LBL = { sleep: ['Sleep', 'h'], deep: ['Deep sleep', 'h'], rem: ['REM', 'h'], hrv: ['HRV', 'ms'], rhr: ['Resting HR', 'bpm'], steps: ['Steps', ''], active: ['Active energy', 'kcal'],
    exmin: ['Exercise', 'min'], daylight: ['Daylight', 'min'], vo2: ['VO₂max', ''], bed: ['Bedtime', 'h'], wake: ['Wake', 'h'], mindful: ['Mindful', 'min'], resp: ['Breathing', '/min'], cal: ['Eaten', 'kcal'] };
  openSheet({
    id: 'health-link', title: 'Apple Health imported',
    render: () => `<div class="hl-ok">${icon('tick', 22, 2.6)}<b>${n} value${n === 1 ? '' : 's'} sent to ARK</b><span class="sub">Synced through GitHub — your PC applies them when it is on.</span></div>
      ${P.map(p => `<div class="grp-h">${p.day === today() ? 'Today' : esc(p.day)}</div><section class="list frost">${Object.keys(p.fields).map(k => `<div class="li"><span class="tx"><div class="tt">${esc((LBL[k] || [k])[0])}</div></span><b class="num">${fmt1(p.fields[k])} ${esc((LBL[k] || ['', ''])[1])}</b></div>`).join('')}
        ${p.weightKg !== null ? `<div class="li"><span class="tx"><div class="tt">Weight</div></span><b class="num">${fmt1(p.weightKg)} kg</b></div>` : ''}</section>`).join('')}
      <p class="sub" style="text-align:center;margin-top:14px">You can close this tab.</p>`,
  });
}

export const actions = {
  'meal-new'() { mealSheet(null); },
  'meal-manage'() {
    openSheet({ id: 'meals', title: 'Saved meals', render: () => `<section class="list frost">${(view().meals || []).map(m => `<button class="li" data-act="meal-edit" data-id="${esc(m.id)}"><span class="tx"><div class="tt">${esc(m.name)}</div><div class="st">${m.prot} g protein · ${m.cal} kcal</div></span><span class="chev">${icon('chev', 16)}</span></button>`).join('')}</section>` });
  },
  'meal-edit'(d) { const m = (view().meals || []).find(x => x.id === d.id); if (m) { closeSheet(topSheet()); mealSheet(m); } },
  'meal-eat'(d) { const m = (view().meals || []).find(x => x.id === d.id); if (m) eat(m); },
  'meal-uneat'(d) {
    const t = today(), pend = state.pending.find(e => !e.seq && e.type === 'meal.eat' && e.data.item && e.data.item.eid === d.eid);
    if (pend) { dropPending(pend.id); toast('Removed'); return; }
    emit('meal.uneat', { day: t, eid: d.eid }); haptic(); toast('Removed');
  },
  'meal-save'(d) {
    mealRead();
    const m = L.cleanMeal(mealDraft);
    if (!m) { toast('A name and protein or calories'); return; }
    emit('meal.set', { meal: m }); closeSheet(topSheet());
    if (d.eat === '1') eat(m); else { haptic(); toast('Saved'); }
  },
  'meal-once'() {
    mealRead();
    const m = L.cleanMeal(mealDraft);
    if (!m) { toast('A name and protein or calories'); return; }
    closeSheet(topSheet());
    emitUndoable('meal.eat', { day: today(), item: { eid: 'm' + uid(), name: m.name, prot: m.prot, cal: m.cal, at: new Date().toISOString() } }, '🍽 ' + m.name + ' logged');
  },
  'meal-del'() {
    const id = mealDraft.id; closeSheet(topSheet());
    const onPc = ((state.snapshot && state.snapshot.meals) || []).some(x => x.id === id);
    if (!onPc) { state.pending.filter(e => !e.seq && e.type === 'meal.set' && e.data.meal && e.data.meal.id === id).forEach(e => dropPending(e.id)); toast('Deleted'); return; }
    emitUndoable('meal.del', { id }, 'Meal deleted');
  },
};
