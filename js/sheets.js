/* ARK Mobile — bottom sheets: pairing, sync & settings, and the quick logs. */
import {
  L, state, view, emit, changed, esc, icon, today, shiftDay, fmt1, fmtDay, fmtMins, ago,
  openSheet, closeSheet, topSheet, toast, haptic, pair, unpair, syncNow, syncLabel, hubBase, syncState, pcAsOf, pcAgeMin, onPublicCopy } from './core.js';
import { vitalsCard, pillarColor, journalRow } from './views.js';
import { weighList, practiceList, appearanceChips } from './more.js';

/* ── pairing ── */
let pairMsg = '';
export function pairSheet() {
  pairMsg = '';
  openSheet({
    id: 'pair', title: 'Connect to your PC',
    render: () => onPublicCopy() ? publicPair() : `
      <ol class="steps">
        <li><span>On your PC, open ARK and click <b>📱 Phone</b> in the top bar.</span></li>
        <li><span>Type the 6-digit code it shows. Codes last 10 minutes.</span></li>
      </ol>
      <div class="code"><input id="pair-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="••••••" aria-label="Pairing code"></div>
      ${pairMsg ? `<p style="color:var(--red);text-align:center;font-size:.9rem;margin:-6px 0 14px">${esc(pairMsg)}</p>` : ''}
      <button class="btn btn-prominent block" data-act="pair-go">Connect</button>
      <details style="margin-top:18px"><summary class="sub" style="cursor:pointer">Connecting to a different address</summary>
        <label class="field" style="margin-top:10px"><span>ARK on your PC</span>
          <input class="inp" id="pair-hub" value="${esc(hubBase())}" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
        <p class="sub" style="line-height:1.5">Normally this is the address you opened this app from. Change it only if your PC's address changed.</p>
      </details>`,
  });
  setTimeout(() => document.getElementById('pair-code')?.focus(), 450);
}

/* The GitHub copy connects through the PC's QR code (#relay=…). A Home Screen app starts with empty
   storage and no link to follow, so it scans that same QR code itself with the camera. */
function publicPair() {
  return `<p class="sub" style="line-height:1.5;margin:0 0 14px">On your PC open ARK → <b>📱 Phone</b>, then scan the QR code shown there.</p>
    <div id="qr-box" style="position:relative;border-radius:18px;overflow:hidden;background:#000;aspect-ratio:1;margin-bottom:14px;display:none">
      <video id="qr-video" playsinline muted autoplay style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;inset:18%;border:2px solid rgba(255,255,255,.8);border-radius:14px;pointer-events:none"></div></div>
    ${pairMsg ? `<p style="color:var(--red);text-align:center;font-size:.9rem;margin:0 0 14px;line-height:1.45">${esc(pairMsg)}</p>` : ''}
    <button class="btn btn-prominent block" data-act="qr-scan">${icon('camera', 17)} Scan QR code</button>`;
}

let qrStream = null;
const WRONG_QR = "That is not ARK's QR code — use the one in 📱 Phone on the PC.";
function qrStop() { if (qrStream) { qrStream.getTracks().forEach(t => t.stop()); qrStream = null; } }
function loadJsQR() {
  return window.jsQR ? Promise.resolve(window.jsQR) : new Promise((res, rej) => {
    const sc = document.createElement('script'); sc.src = 'vendor/jsQR.js';
    sc.onload = () => res(window.jsQR); sc.onerror = () => rej(new Error('scanner did not load'));
    document.head.appendChild(sc);
  });
}
async function qrScan() {
  const fail = msg => { qrStop(); pairMsg = msg; const box = document.getElementById('qr-box'); if (box) box.style.display = 'none'; changed(); };
  try {
    const [jsQR, stream] = await Promise.all([loadJsQR(), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })]);
    qrStop(); qrStream = stream; pairMsg = '';
    const video = document.getElementById('qr-video'), box = document.getElementById('qr-box');
    if (!video) return qrStop();
    box.style.display = ''; video.srcObject = stream; await video.play().catch(() => {});
    // Read the centre square at the camera's full resolution: a dense code on a screen needs every pixel
    // (a shrunk frame left ~3 px per square and nothing decoded). Alternate a zoomed-in centre crop and the
    // whole square, so both a near and a far code are caught; ~6 reads a second keeps the phone cool.
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const started = Date.now(); let n = 0, last = 0;
    const tick = t => {
      if (!qrStream) return;
      if (!document.contains(video) || Date.now() - started > 180000) return qrStop();   // sheet closed or 3 min idle
      if (video.videoWidth && t - last > 150) {
        last = t; n++;
        const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh) * (n % 2 ? 1 : 0.6);
        const sz = Math.min(1000, Math.round(side));
        cv.width = cv.height = sz;
        cx.drawImage(video, (vw - side) / 2, (vh - side) / 2, side, side, 0, 0, sz, sz);
        const hit = jsQR(cx.getImageData(0, 0, sz, sz).data, sz, sz, { inversionAttempts: 'attemptBoth' });
        const m = hit && /#relay=([\w-]+)/.exec(hit.data);
        if (m) { qrStop(); haptic(); location.hash = 'relay=' + m[1]; location.reload(); return; }
        if (hit && pairMsg !== WRONG_QR) { pairMsg = WRONG_QR; changed(); }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) {
    fail(/NotAllowed|denied/i.test(String(e && (e.name || e.message)))
      ? 'Camera access is off. Allow it in Settings → Safari → Camera (or tap Scan again and choose Allow).'
      : 'Could not start the camera: ' + String(e && e.message || e));
  }
}

/* ── sync & settings ── */
export function syncSheet() {
  openSheet({
    id: 'sync', title: 'Sync & settings',
    render: () => {
      const s = syncLabel(), st = state.settings;
      const waiting = state.pending.length, unsent = state.pending.filter(e => !e.seq).length;
      const chips = (key, opts, fmt) => `<div class="chips">${opts.map(o => `<button class="chip ${st[key] === o ? 'on' : ''}" data-act="setting" data-k="${key}" data-v="${o}">${fmt ? fmt(o) : o}</button>`).join('')}</div>`;
      return `
      <section class="card frost" style="margin-bottom:14px">
        <div class="row"><span class="circle sm" style="background:${s.tone === 'ok' ? 'rgba(48,209,88,.18)' : s.tone === 'err' ? 'rgba(255,69,58,.16)' : 'var(--fill-2)'};color:${s.tone === 'ok' ? 'var(--green)' : s.tone === 'err' ? 'var(--red)' : 'var(--t1)'}">${icon(state.token ? 'sync' : 'wifi', 17)}</span>
          <div style="flex:1;min-width:0"><b data-sync-label>${esc(s.text)}</b><div class="sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(hubBase())}</div></div></div>
        <div class="row num" style="gap:18px;margin:14px 0 4px;font-size:.86rem">
          <span><b>${unsent}</b> <span class="sub">to send</span></span>
          <span><b>${waiting - unsent}</b> <span class="sub">awaiting PC</span></span>
          <span class="spacer"></span><span class="sub">last ${esc(ago(state.lastSync))}</span></div>
        ${state.snapshot && state.snapshot.generated ? `<div class="sub" style="margin-top:6px">PC data as of ${esc(pcAsOf())}${pcAgeMin() >= 15 ? ' · ARK on the PC has not published since' : ''}</div>` : ''}
        <p class="sub" style="line-height:1.5;margin:10px 0 14px">Your data lives on your PC. This phone keeps the last copy it received plus your changes until the PC confirms it has them — nothing is lost if the PC is off or you have no signal.</p>
        ${state.token
          ? `<button class="btn btn-tint block" data-act="sync-now" ${syncState.busy ? 'disabled' : ''}>${icon('sync', 17)} Sync now</button>`
          : `<button class="btn btn-prominent block" data-act="pair-sheet">Connect to your PC</button>`}
      </section>
      <section class="list frost" style="margin-bottom:4px">
        <button class="li" data-act="notify-sheet" style="--c:#ff453a"><span class="ic">${icon('bell', 18)}</span><span class="tx"><div class="tt">Notifications</div>
          <div class="st">${state.push.on ? 'On — habits, vitals, weigh-in, rest timer' : 'Reminders sent by your PC'}</div></span><span class="chev">${icon('chev', 16)}</span></button>
        <button class="li" data-act="health-sheet" style="--c:#ff375f"><span class="ic">${icon('heart', 18)}</span><span class="tx"><div class="tt">Apple Health</div>
          <div class="st">${view().health ? 'Last import ' + esc(ago(Date.parse(view().health.ts))) : 'Sleep, HR, HRV, steps, weight via a Shortcut'}</div></span><span class="chev">${icon('chev', 16)}</span></button>
        <button class="li" data-act="siri-sheet" style="--c:#bf5af2"><span class="ic">${icon('bolt', 18)}</span><span class="tx"><div class="tt">Siri & Apple Watch</div>
          <div class="st">Log by voice or from your wrist</div></span><span class="chev">${icon('chev', 16)}</span></button>
      </section>
      <div class="grp-h">Appearance</div>
      <section class="card frost">${appearanceChips()}<p class="sub" style="margin:10px 0 0;line-height:1.5">Dark is ARK's own look. Light follows the same design for bright gyms and daylight.</p></section>
      <div class="grp-h">Targets</div>
      <section class="card frost">
        <div class="eyebrow" style="margin-bottom:8px">Workouts per week</div>${chips('weeklyWorkouts', [2, 3, 4, 5, 6])}
        <div class="eyebrow" style="margin:16px 0 8px">Daily practice</div>${chips('practiceMins', [15, 30, 45, 60, 90], v => v + ' min')}
      </section>
      <div class="grp-h">Workout</div>
      <section class="card frost">
        <div class="eyebrow" style="margin-bottom:8px">Rest timer</div>${chips('rest', [60, 90, 120, 180], v => v < 120 ? v + ' s' : v / 60 + ' min')}
        <div class="eyebrow" style="margin:16px 0 8px">Weight step for barbell & machines</div>${chips('step', [1.25, 2.5, 5], v => v + ' ' + (view().unit || 'kg'))}
        <p class="sub" style="margin:12px 0 0;line-height:1.5">Targets use double progression: beat your weakest set by a rep; once every set reaches 12, add one step. Dumbbells step by 2.</p>
      </section>
      <div class="grp-h">This phone</div>
      <section class="card frost">
        <label class="field"><span>Name shown on your PC</span><input class="inp" id="dev-name" value="${esc(state.deviceName)}" maxlength="30"></label>
        <button class="btn btn-glass block" data-act="dev-name">Save name</button>
        ${state.token ? `<button class="btn btn-danger block" style="margin-top:10px" data-act="unpair">Disconnect this phone</button>` : ''}
      </section>
      <p class="foot">ARK Mobile · ${state.pending.length ? state.pending.length + ' queued' : 'queue empty'}</p>`;
    },
  });
}

/* ── weigh-in ── */
let wDraft = null, wDay = null;
export function weighSheet() {
  const v = view(), ks = Object.keys(v.weights).sort();
  wDraft = ks.length ? v.weights[ks[ks.length - 1]] : (v.profile.weight || 80);
  wDay = today();
  openSheet({
    id: 'weigh', title: 'Weigh-in',
    render: () => `
      <div style="text-align:center;margin:10px 0 6px"><span class="num" style="font-size:3.6rem;font-weight:700;letter-spacing:-.03em">${fmt1(wDraft)}</span><span class="sub" style="font-size:1.1rem"> kg</span></div>
      <div class="row" style="justify-content:center;gap:10px;margin-bottom:18px">
        ${[-1, -0.1, 0.1, 1].map(d => `<button class="btn btn-glass sm num" style="min-width:64px" data-act="w-step" data-d="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}</div>
      <input class="inp num" type="number" inputmode="decimal" step="0.1" min="30" max="250" value="${fmt1(wDraft)}" data-w-input style="text-align:center;margin-bottom:14px" aria-label="Weight in kilograms">
      <div class="seg" style="margin-bottom:18px">${[0, 1, 2].map(i => { const k = shiftDay(today(), -i); return `<button class="${wDay === k ? 'on' : ''}" data-act="w-day" data-day="${k}">${i === 0 ? 'Today' : i === 1 ? 'Yesterday' : fmtDay(k, { weekday: 'short' })}</button>`; }).join('')}</div>
      <button class="btn btn-prominent block" style="--accent:#40c8e0" data-act="w-save">Save weigh-in</button>
      <p class="sub" style="text-align:center;margin-top:12px">Same time of day, same conditions — the trend matters, not the single number.</p>
      ${weighList()}`,
  });
}

/* ── vitals ── */
export function vitalsSheet() {
  openSheet({ id: 'vitals', title: 'Vitals · ' + fmtDay(today(), { weekday: 'long' }), render: () => vitalsCard(today())
    + `<p class="sub" style="margin-top:12px;line-height:1.5">Every tap is saved. ARK on your PC turns these into today's readiness.</p>` });
}

/* ── practice ── */
let pSkill = null, pMins = 20, pNote = '';
export function practiceSheet(skill) {
  const v = view(), sk = v.skills.filter(s => s.status !== 'archived');
  if (!sk.length) { toast('Add a skill in ARK on your PC first'); return; }
  pSkill = skill && sk.some(s => s.id === skill) ? skill : sk.slice().sort((a, b) => (b.last || '').localeCompare(a.last || ''))[0].id;
  pMins = 20; pNote = '';
  openSheet({
    id: 'practice', title: 'Log practice',
    render: () => {
      const cur = view().skills.find(s => s.id === pSkill);
      return `<div class="eyebrow" style="margin-bottom:8px">Skill</div>
        <div class="chips" style="margin-bottom:18px">${sk.map(s => `<button class="chip ${s.id === pSkill ? 'on' : ''}" style="--accent:${pillarColor(s.cat)}" data-act="p-skill" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join('')}</div>
        <div class="eyebrow" style="margin-bottom:8px">Duration</div>
        <div class="chips" style="margin-bottom:10px">${[10, 15, 20, 30, 45, 60, 90].map(m => `<button class="chip ${pMins === m ? 'on' : ''}" data-act="p-mins" data-m="${m}">${m < 60 ? m + 'm' : m / 60 + 'h'}</button>`).join('')}</div>
        <input class="inp num" type="number" inputmode="numeric" min="1" max="720" placeholder="Other — minutes" data-p-mins style="margin-bottom:14px">
        <textarea class="inp" placeholder="What did you work on? (optional)" data-p-note maxlength="400">${esc(pNote)}</textarea>
        <button class="btn btn-prominent block" style="margin-top:14px" data-act="p-save">Save ${fmtMins(pMins)}${cur ? ' of ' + esc(cur.name) : ''}</button>
        ${cur ? `<p class="sub" style="text-align:center;margin-top:12px">${cur.count} sessions · ${fmtMins(cur.mins)} so far</p>` : ''}
        ${practiceList(pSkill)}`;
    },
  });
}

/* ── note ── */
let nCat = 'log';
export function noteSheet() {
  nCat = 'log';
  openSheet({
    id: 'note', title: 'New note',
    render: () => `<div class="seg" style="margin-bottom:14px">${[['log', 'Log'], ['win', 'Win'], ['lesson', 'Lesson'], ['idea', 'Idea']].map(c =>
      `<button class="${nCat === c[0] ? 'on' : ''}" data-act="n-cat" data-c="${c[0]}">${c[1]}</button>`).join('')}</div>
      <textarea class="inp" data-n-text placeholder="What happened?" maxlength="2000" style="min-height:150px"></textarea>
      <button class="btn btn-prominent block" style="margin-top:14px;--accent:#ffb340" data-act="n-save">Add to Journal</button>`,
  });
  setTimeout(() => document.querySelector('[data-n-text]')?.focus(), 450);
}

export function journalSheet() {
  openSheet({
    id: 'journal', title: 'Journal',
    render: () => {
      const J = view().journal || [];
      return `<button class="btn btn-tint block" style="--accent:#ffb340;margin-bottom:12px" data-act="note-sheet">${icon('note', 17)} New note</button>`
        + (J.length ? `<section class="list frost">${J.map(e => journalRow(e, true)).join('')}</section>` : `<div class="empty">Nothing in the journal yet.</div>`)
        + `<p class="sub" style="text-align:center;margin-top:12px">The last 40 entries from ARK on your PC. Your notes can be deleted here; anything deleted can be restored from 📱 Phone on the PC.</p>`;
    },
  });
}

export const actions = {
  'journal-sheet'() { journalSheet(); },
  'pair-sheet'() { pairSheet(); },
  'qr-scan'() { qrScan(); },
  'pair-scan'() { pairSheet(); setTimeout(qrScan, 350); },
  async 'pair-go'() {
    const code = document.getElementById('pair-code')?.value || '';
    const hub = document.getElementById('pair-hub')?.value.trim();
    if (code.replace(/\D/g, '').length !== 6) { pairMsg = 'Enter the 6 digits shown on your PC.'; topSheet()?.refresh(); return; }
    const r = await pair(code, hub && hub !== hubBase() ? hub : null);
    if (!r.ok) topSheet()?.refresh();
    if (r.ok) { closeSheet(topSheet()); haptic(); toast('Connected to ARK ✓'); }
    else { pairMsg = r.msg; topSheet()?.refresh(); }
  },
  'sync-sheet'() { syncSheet(); },
  async 'sync-now'() { const ok = await syncNow(); toast(ok ? 'Up to date' : syncLabel().text); },
  setting(d) {
    state.settings[d.k] = Number(d.v); changed({ now: true });
    // The PC's Sunday review line reads "2/3 workouts" against this target.
    if (d.k === 'weeklyWorkouts') emit('push.prefs', { prefs: { target: Number(d.v) } });
  },
  'dev-name'() { const n = document.getElementById('dev-name')?.value.trim(); if (n) { state.deviceName = n; changed({ now: true }); toast('Saved'); } },
  unpair() {
    const n = state.pending.filter(e => !e.seq).length;
    if (!confirm(n ? `${n} change${n === 1 ? ' has' : 's have'} not reached your PC yet and will stay queued on this phone. Disconnect anyway?` : 'Disconnect this phone from ARK?')) return;
    unpair(); closeSheet(topSheet());
  },
  'weigh-sheet'() { weighSheet(); },
  'w-step'(d) { wDraft = Math.max(30, Math.min(250, Math.round((wDraft + Number(d.d)) * 10) / 10)); haptic(); topSheet()?.refresh(); },
  'w-day'(d) { wDay = d.day; topSheet()?.refresh(); },
  'w-save'() {
    const kg = Math.round(wDraft * 10) / 10;
    if (!(kg >= 30 && kg <= 250)) { toast('Enter a weight between 30 and 250 kg'); return; }
    emit('weight.set', { day: wDay, kg }); closeSheet(topSheet()); haptic();
    toast('⚖ ' + fmt1(kg) + ' kg saved', 'Undo', () => emit('weight.del', { day: wDay }));
  },
  'vitals-sheet'() { vitalsSheet(); },
  'practice-sheet'(d) { practiceSheet(d.skill); },
  'p-skill'(d) { pSkill = d.id; savePNote(); topSheet()?.refresh(); },
  'p-mins'(d) { pMins = Number(d.m); savePNote(); topSheet()?.refresh(); },
  'p-save'() {
    savePNote();
    const custom = Number(document.querySelector('[data-p-mins]')?.value);
    const mins = custom > 0 ? Math.round(custom) : pMins;
    if (!(mins > 0 && mins <= 720)) { toast('Minutes must be between 1 and 720'); return; }
    emit('skill.practice', { skill: pSkill, mins, note: pNote.trim(), date: new Date().toISOString() });
    closeSheet(topSheet()); haptic(); toast('Practice saved · ' + fmtMins(mins));
  },
  'note-sheet'() { noteSheet(); },
  'n-cat'(d) { const t = document.querySelector('[data-n-text]')?.value || ''; nCat = d.c; topSheet()?.refresh(); const el = document.querySelector('[data-n-text]'); if (el) el.value = t; },
  'n-save'() {
    const text = (document.querySelector('[data-n-text]')?.value || '').trim();
    if (!text) { toast('Write something first'); return; }
    emit('note.add', { text, cat: nCat }); closeSheet(topSheet()); haptic(); toast('Added to your Journal');
  },
};
function savePNote() { const el = document.querySelector('[data-p-note]'); if (el) pNote = el.value; }
/** The weigh-in field and the steppers edit the same draft. */
export function onWeighInput(el) { const n = parseFloat(String(el.value).replace(',', '.')); if (isFinite(n)) wDraft = n; }
