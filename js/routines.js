/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — daily routines (Today) and the Books tab (Grow).

   A routine is a short checklist for a part of the day: morning, training,
   wind-down. Ticking a step is an event (dayroutine.check); a step can carry
   an effect (minutes of light, cold, calm) that the mind and hormone models
   read, and doses that are logged with the time you ticked it — collagen +
   vitamin C before training reaches the tendon model that way.

   Books holds protocols summarised in ARK's own words (logic/routines.ts),
   each with an evidence grade, one tap from a routine or a habit.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, view, emit, changed, esc, icon, today, uid, toast, haptic, openSheet, topSheet, closeSheet } from './core.js';

const WHEN = [['morning', 'Morning'], ['training', 'Training'], ['evening', 'Evening'], ['anytime', 'Anytime']];
const EV_COL = { Strong: '#30d158', Moderate: '#ffb340', Emerging: '#8e8e93' };
const EFF_TXT = { sunlight: 'min light', cold: 'min cold', meditation: 'min calm', walk: 'min walk', mobility: 'min mobility', sauna: 'min sauna' };
const routines = () => { const r = view().dayRoutines; return Array.isArray(r) && r.length ? r : L.DEFAULT_DAY_ROUTINES; };
const logFor = (day, id) => (((view().routineLog || {})[day] || {})[id] || []);
let sel = null;

/** Which routine fits now: training while a workout is on or was logged today, else by the clock. */
function current() {
  const rs = routines(), h = new Date().getHours(), t = today();
  if (sel && rs.some(r => r.id === sel)) return rs.find(r => r.id === sel);
  const trained = state.workout || view().workouts.some(w => w.date === t);
  const want = h >= 18 ? 'evening' : h < 11 ? 'morning' : trained ? 'training' : 'anytime';
  return rs.find(r => r.when === want) || rs.find(r => r.when === (h < 14 ? 'morning' : 'evening')) || rs[0];
}
const tagsOf = st => [
  ...Object.keys(st.effect || {}).filter(k => st.effect[k] > 0).map(k => st.effect[k] + ' ' + (EFF_TXT[k] || k)),
  ...(st.doses || []).map(d => { const def = ((view().bioDefs || {}).micros || []).find(m => m.k === d.k); return (def ? def.icon + ' ' : '') + d.amount + ' ' + (def ? def.unit : '') + ' ' + (def ? def.name : d.k); }),
];

/* ── Today: the routine card ── */
export function routineCard() {
  const rs = routines(), r = current(); if (!r) return '';
  const t = today(), done = logFor(t, r.id);
  // The selected routine may sit past the card edge: bring it into view once drawn (horizontally only).
  setTimeout(() => { const on = document.querySelector('.rt-pick .chip.on'); if (on) { const p = on.parentNode; p.scrollLeft += on.getBoundingClientRect().left - p.getBoundingClientRect().left - (p.clientWidth - on.offsetWidth) / 2; } }, 0);
  return `<div class="sec"><h2>Routine</h2><button class="link" data-act="rt-manage">Edit</button></div>
    <section class="card frost rt-card">
      <div class="chips scroll1 rt-pick">${rs.map(x => { const n = logFor(t, x.id).length;
        return `<button class="chip ${x.id === r.id ? 'on' : ''}" data-act="rt-sel" data-id="${esc(x.id)}">${esc(x.icon || '•')} ${esc(x.name)}${n ? ` <small>${n}/${x.steps.length}</small>` : ''}</button>`; }).join('')}</div>
      <div class="rt-prog"><span class="t"><i style="width:${r.steps.length ? done.length / r.steps.length * 100 : 0}%"></i></span><b class="num">${done.length}/${r.steps.length}</b></div>
      ${r.steps.map((st, i) => { const on = done.includes(i), tags = tagsOf(st);
        return `<button class="rt-step${on ? ' on' : ''}" data-act="rt-check" data-id="${esc(r.id)}" data-i="${i}" aria-pressed="${on}">
          <span class="ck">${icon('tick', 15, 3)}</span><span class="tx"><span class="tt">${esc(st.t)}</span>
          ${tags.length ? `<span class="rt-tag">${tags.map(esc).join(' · ')}</span>` : ''}${st.why && !on ? `<span class="why">${esc(st.why)}</span>` : ''}</span></button>`; }).join('')}
      ${!r.steps.length ? '<div class="empty">No steps yet — tap Edit to add some.</div>' : ''}
    </section>`;
}

/* ── editing ── */
let draft = null;
function manageSheet() {
  openSheet({
    id: 'rt-manage', title: 'Routines',
    render: () => `<section class="list frost">${routines().map(r => `<button class="li" data-act="rt-edit" data-id="${esc(r.id)}"><span class="ic" style="--c:#40c8e0">${esc(r.icon || '•')}</span>
        <span class="tx"><div class="tt">${esc(r.name)}</div><div class="st">${(WHEN.find(w => w[0] === r.when) || WHEN[3])[1]} · ${r.steps.length} step${r.steps.length === 1 ? '' : 's'}</div></span><span class="chev">${icon('chev', 15)}</span></button>`).join('')}</section>
      <button class="btn btn-tint block" style="margin-top:12px;--accent:#40c8e0" data-act="rt-edit" data-id="">${icon('plus', 16)} New routine</button>
      <p class="sub" style="line-height:1.5;margin-top:12px">Steps can come from the protocols in Grow › Books. A step with minutes of light, cold or calm feeds the mind and hormone estimates when you tick it.</p>`,
  });
}
function editSheet(id) {
  const r = routines().find(x => x.id === id);
  draft = r ? JSON.parse(JSON.stringify(r)) : { id: 'r-' + uid(), name: '', icon: '⭐', when: 'anytime', steps: [] };
  const isNew = !r;
  openSheet({
    id: 'rt-edit', title: isNew ? 'New routine' : 'Edit routine',
    render: () => `<label class="field"><span>Name</span><input class="inp" data-rt-f="name" maxlength="40" value="${esc(draft.name)}" placeholder="e.g. Sleep"></label>
      <div class="eyebrow" style="margin:4px 0 8px">When</div>
      <div class="seg" style="margin-bottom:14px">${WHEN.map(([k, l]) => `<button class="${draft.when === k ? 'on' : ''}" data-act="rt-when" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="eyebrow" style="margin:4px 0 8px">Icon</div>
      <div class="chips" style="margin-bottom:14px">${['🌅', '🏋️', '🌙', '🧠', '☀️', '🧊', '🧘', '📚', '⭐'].map(i => `<button class="chip ${draft.icon === i ? 'on' : ''}" data-act="rt-icon" data-v="${i}">${i}</button>`).join('')}</div>
      <div class="eyebrow" style="margin:4px 0 8px">Steps</div>
      <div class="rt-steps">${draft.steps.map((st, i) => `<div class="rt-srow"><input class="inp" data-rt-step="${i}" maxlength="120" value="${esc(st.t)}">
        <button class="circle sm" data-act="rt-sdel" data-i="${i}" aria-label="Remove step">${icon('x', 14)}</button>
        ${tagsOf(st).length ? `<div class="rt-tag">${tagsOf(st).map(esc).join(' · ')}</div>` : ''}</div>`).join('')}</div>
      <div class="row" style="gap:8px;margin-top:8px"><button class="btn sm btn-glass" style="flex:1" data-act="rt-sadd">${icon('plus', 15)} Add step</button>
        <button class="btn sm btn-glass" style="flex:1" data-act="rt-from-proto">${icon('book', 15)} From protocols</button></div>
      <button class="btn btn-prominent block" style="margin-top:18px;--accent:#40c8e0" data-act="rt-save">Save routine</button>
      ${isNew ? '' : `<button class="btn btn-danger block" style="margin-top:10px" data-act="rt-del" data-id="${esc(draft.id)}">${icon('trash', 16)} Delete routine</button>`}`,
  });
}
function readDraft() {
  if (!draft) return;
  const n = document.querySelector('[data-rt-f="name"]'); if (n) draft.name = n.value;
  document.querySelectorAll('[data-rt-step]').forEach(el => { const s = draft.steps[Number(el.dataset.rtStep)]; if (s) s.t = el.value; });
}
function redraw() { readDraft(); const s = topSheet(); s && s.refresh(); }
function protoPicker() {
  openSheet({
    id: 'rt-proto', title: 'Add from protocols',
    render: () => `<section class="list frost">${L.PROTOCOLS.filter(p => p.step).map(p => `<button class="li" data-act="rt-proto-add" data-id="${p.id}">
      <span class="tx"><div class="tt">${esc(p.step.t)}</div><div class="st">${esc(p.title)} · <span style="color:${EV_COL[p.evidence]}">${p.evidence}</span></div></span><span class="chev">${icon('plus', 15)}</span></button>`).join('')}</section>`,
  });
}
function saveRoutine(r) {
  emit('dayroutine.save', { routine: { id: r.id, name: r.name.trim().slice(0, 40), icon: r.icon, when: r.when, steps: r.steps.filter(s => s.t && s.t.trim()).map(s => ({ ...s, t: s.t.trim() })) } });
}

/* ══════════════ Grow › Books ══════════════ */
let chapter = null, open = null;
// Remember which protocol is open, so a redraw (after "Add to routine") keeps it open.
document.addEventListener('toggle', e => { const d = e.target; if (d && d.matches && d.matches('details.proto')) { if (d.open) open = d.dataset.proto; else if (open === d.dataset.proto) open = null; } }, true);
/** A photo of your own copy becomes the sticker: centre-cropped to a book's 2:3, kept small, stored on this phone only. */
document.addEventListener('change', async e => {
  const el = e.target; if (!el || !el.matches || !el.matches('[data-cover-file]') || !el.files || !el.files[0]) return;
  try {
    const url = URL.createObjectURL(el.files[0]);
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const W = 240, Hh = 360, r = Math.min(img.naturalWidth / 2, img.naturalHeight / 3);
    const sw = r * 2, sh = r * 3, sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
    const c = document.createElement('canvas'); c.width = W; c.height = Hh;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, W, Hh);
    URL.revokeObjectURL(url);
    state.settings.covers = { ...(state.settings.covers || {}), [el.dataset.coverFile]: c.toDataURL('image/jpeg', 0.82) };
    changed({ now: true }); haptic();
  } catch (err) { toast('Could not read that photo'); }
});
export function renderBooks() {
  const B = L.BOOKS[0];
  const ch = chapter || L.CHAPTERS[0];
  const list = L.PROTOCOLS.filter(p => p.chapter === ch);
  const habits = view().habits.map(h => h.name.toLowerCase());
  const rs = routines();
  const cover = (state.settings.covers || {})[B.id];
  let H = `<section class="book-row"><label class="sticker${cover ? ' photo' : ''}" style="--bk:${B.color};--ink:${B.ink}" aria-label="${esc(B.title)} by ${esc(B.author)} — tap to use a photo of your copy">
      ${cover ? `<img src="${cover}" alt="">` : `<div class="st-in"><span class="st-top">${esc(B.author.toUpperCase())}</span><b>${esc(B.title.toUpperCase())}</b></div>`}
      <input type="file" accept="image/*" data-cover-file="${B.id}" hidden></label>
    <div class="book-meta"><b>${esc(B.title)}</b><div class="sub">${esc(B.author)}</div>
      <div class="sub" style="margin-top:4px">${L.PROTOCOLS.length} protocols · ${L.CHAPTERS.length} chapters</div>
      <div class="sub" style="margin-top:6px;font-size:.72rem">${cover ? 'Tap the cover to change the photo' : 'Tap the cover to use a photo of your own copy'}</div></div></section>
    <details class="book-about"><summary>About these notes</summary><p class="sub">${esc(B.note)}</p></details>`;
  H += `<div class="chips scroll1" style="margin:12px 0">${L.CHAPTERS.map(c => `<button class="chip ${c === ch ? 'on' : ''}" data-act="bk-ch" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <section class="list frost protos">`;
  H += list.map(p => {
    const inRt = p.step && rs.some(r => r.steps.some(s => s.t === p.step.t));
    const hasH = p.habit && habits.includes(p.habit.name.toLowerCase());
    return `<details class="proto"${open === p.id ? ' open' : ''} data-proto="${p.id}">
      <summary><span class="pt">${esc(p.title)}</span><span class="tag" style="--c:${EV_COL[p.evidence]}">${p.evidence}</span></summary>
      <div class="pb"><ul>${p.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
      <p class="why">${esc(p.why)}</p>
      ${p.step || p.habit ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px">
        ${p.step ? `<button class="btn sm ${inRt ? 'btn-glass' : 'btn-tint'}" style="--accent:#40c8e0" data-act="bk-routine" data-id="${p.id}" ${inRt ? 'disabled' : ''}>${inRt ? icon('tick', 14, 2.6) + ' In a routine' : icon('plus', 14) + ' Add to routine'}</button>` : ''}
        ${p.habit ? `<button class="btn sm ${hasH ? 'btn-glass' : 'btn-tint'}" style="--accent:#30d158" data-act="bk-habit" data-id="${p.id}" ${hasH ? 'disabled' : ''}>${hasH ? icon('tick', 14, 2.6) + ' A habit' : icon('plus', 14) + ' Make it a habit'}</button>` : ''}</div>` : ''}
    </div></details>`;
  }).join('');
  H += `</section><p class="sub" style="line-height:1.5;margin:14px 2px 0">Evidence: <b style="color:${EV_COL.Strong}">Strong</b> = consistent human trials; <b style="color:${EV_COL.Moderate}">Moderate</b> = some trials or strong mechanism; <b style="color:${EV_COL.Emerging}">Emerging</b> = small or early studies. Not medical advice.</p>`;
  return H;
}

/* ══════════════ actions ══════════════ */
export const actions = {
  'rt-sel'(d) { sel = d.id; haptic(); changed(); },
  'rt-check'(d) {
    const t = today(), r = routines().find(x => x.id === d.id); if (!r) return;
    const i = Number(d.i), st = r.steps[i], on = !logFor(t, r.id).includes(i);
    haptic();
    emit('dayroutine.check', { day: t, id: r.id, step: i, done: on });
    // Doses on a step are logged with the time it was ticked, and removed again if it is unticked.
    const pre = 'rd-' + t + '-' + r.id + '-' + i + '-';
    if (on && st && st.doses && st.doses.length) {
      st.doses.forEach(x => emit('dose.add', { dose: { id: pre + x.k + '-' + Date.now().toString(36), k: x.k, amount: x.amount, at: new Date().toISOString() } }));
      toast('Logged ' + tagsOf({ doses: st.doses }).join(' + '));
    }
    if (!on) (view().doses || []).filter(x => String(x.id || '').startsWith(pre)).forEach(x => emit('dose.del', { id: x.id }));
  },
  'rt-manage'() { manageSheet(); },
  'rt-edit'(d) { editSheet(d.id); },
  'rt-when'(d) { readDraft(); draft.when = d.v; redraw(); },
  'rt-icon'(d) { readDraft(); draft.icon = d.v; redraw(); },
  'rt-sadd'() { readDraft(); draft.steps.push({ t: '' }); redraw(); setTimeout(() => { const els = document.querySelectorAll('[data-rt-step]'); els[els.length - 1]?.focus(); }, 50); },
  'rt-sdel'(d) { readDraft(); draft.steps.splice(Number(d.i), 1); redraw(); },
  'rt-from-proto'() { readDraft(); protoPicker(); },
  'rt-proto-add'(d) {
    const p = L.PROTOCOLS.find(x => x.id === d.id); if (!p || !p.step || !draft) return;
    if (!draft.steps.some(s => s.t === p.step.t)) draft.steps.push(JSON.parse(JSON.stringify(p.step)));
    closeSheet(topSheet()); haptic(); const s = topSheet(); s && s.refresh();
  },
  'rt-save'() {
    readDraft();
    if (!draft.name.trim()) { toast('Name the routine'); return; }
    saveRoutine(draft); closeSheet(topSheet()); haptic(); toast('Routine saved · ' + draft.name.trim());
  },
  'rt-del'(d) {
    const r = routines().find(x => x.id === d.id); if (!r) return;
    if (!confirm('Delete the routine “' + r.name + '”? Days you already ticked stay in your history.')) return;
    emit('dayroutine.del', { id: r.id }); closeSheet(topSheet()); if (sel === r.id) sel = null;
  },
  'bk-ch'(d) { chapter = d.v; haptic(); changed(); },
  'bk-routine'(d) {
    const p = L.PROTOCOLS.find(x => x.id === d.id); if (!p || !p.step) return;
    const rs = routines(), r = rs.find(x => x.id === p.routine) || rs[0];
    if (!r) return;
    if (r.steps.some(s => s.t === p.step.t)) { toast('Already in ' + r.name); return; }
    saveRoutine({ ...r, steps: [...r.steps, JSON.parse(JSON.stringify(p.step))] });
    haptic(); toast('Added to ' + (r.icon || '') + ' ' + r.name);
  },
  'bk-habit'(d) {
    const p = L.PROTOCOLS.find(x => x.id === d.id); if (!p || !p.habit) return;
    if (view().habits.some(h => h.name.toLowerCase() === p.habit.name.toLowerCase())) { toast('You already have that habit'); return; }
    const id = 'hc-' + Date.now();
    emit('habit.add', { habit: { id, name: p.habit.name, icon: p.habit.icon, pillar: p.chapter === 'Exercise' ? 'body' : 'mind' } });
    if (p.habit.effect) emit('habit.edit', { id, effect: p.habit.effect });
    haptic(); toast(p.habit.icon + ' ' + p.habit.name + ' added to Habits');
  },
};
