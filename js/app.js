/* ARK Mobile — boot, navigation, event wiring. */
import {
  state, changed, onChange, icon, esc, syncNow, scheduleSync, syncLabel, closeSheet, topSheet, refreshSheets, paired, haptic, toast, applyTheme, L, onPublicCopy } from './core.js';
import { renderToday, renderHabits, renderGrow, actions as viewActions } from './views.js';
import { renderTrain, actions as trainActions, onSetInput, pickerSearch, restTick, openWorkout, onPlatesInput } from './train.js';
import { actions as sheetActions, onWeighInput } from './sheets.js';
import { renderBodyArch, mountFigure, onTimeline, patchBodyArch, actions as bodyActions } from './body.js';
import { actions as moreActions, onHidden, onVisible } from './more.js';
import { actions as reviewActions } from './review.js';
import { actions as doseActions, onDoseInput } from './doses.js';
import { actions as mindActions } from './mind.js';
import { actions as routineActions } from './routines.js';
import { actions as hormoneActions } from './hormones.js';
import { actions as systemActions, onPhotoInput, onWhatIfInput } from './system.js';

applyTheme();

const TABS = [
  ['today', 'Today', 'hex', renderToday, '#2ee6a6'],
  ['train', 'Train', 'dumbbell', renderTrain, '#ff9f0a'],
  ['habits', 'Habits', 'check', renderHabits, '#30d158'],
  ['body', 'Body', 'heart', renderBodyArch, '#40c8e0', mountFigure],
  ['grow', 'Grow', 'sprout', renderGrow, '#bf5af2'],
];
const scrollPos = {};
const viewEl = document.getElementById('view');
const tabbar = document.getElementById('tabbar');

/* ── tab bar ── */
tabbar.innerHTML = '<span class="tab-lens" aria-hidden="true"></span>' + TABS.map(([id, label, ic]) =>
  `<button class="tab" role="tab" data-act="tab" data-tab="${id}" aria-label="${label}">${icon(ic, 25, 1.8)}<span class="tab-lbl">${label}</span></button>`).join('');

/* Each tab has its own pane that stays in the page. Switching tabs shows a pane that is already
   built; it is redrawn only when the data changed since (dataRev) or it is over a minute old (times,
   "now" read-outs). Rebuilding the whole tab on every switch cost 60–150 ms on a desktop CPU —
   several times that on a phone — and was the lag between tabs. */
const panes = {};
let dataRev = 0;
function paneFor(id) {
  if (!panes[id]) {
    const el = document.createElement('div');
    el.className = 'pane'; el.dataset.pane = id;
    viewEl.appendChild(el);
    panes[id] = { el, rev: -1, at: 0 };
  }
  return panes[id];
}
function render() {
  const i = Math.max(0, TABS.findIndex(t => t[0] === state.tab));
  const [id, label, , fn, accent, after] = TABS[i];
  document.body.dataset.tab = id;
  document.documentElement.style.setProperty('--accent', accent);
  const p = paneFor(id);
  Object.keys(panes).forEach(k => { const on = k === id; if (panes[k].el.hidden === on) panes[k].el.hidden = !on; });
  if (p.rev !== dataRev || Date.now() - p.at > 60000) {
    // Body Arch is long; when it is already built, patch only the sections that changed.
    if (!(id === 'body' && p.rev >= 0 && patchBodyArch())) {
      p.el.innerHTML = fn();
      if (after) after();
    }
    p.rev = dataRev; p.at = Date.now();
  }
  tabbar.style.setProperty('--i', i);
  tabbar.querySelectorAll('.tab').forEach((b, j) => { b.classList.toggle('on', j === i); b.setAttribute('aria-selected', j === i); });
  tabbar.classList.toggle('hide', !paired());
  document.getElementById('edge-title').textContent = label;
  updatePill();
}
let rTm = 0;
function scheduleRender() { cancelAnimationFrame(rTm); rTm = requestAnimationFrame(() => { render(); refreshSheets(); }); }

onChange(opts => {
  if (opts.silent) return;
  if (opts.status) { updateStatusBits(); return; }
  dataRev++;
  scheduleRender();
});
function updateStatusBits() {
  const s = syncLabel();
  document.querySelectorAll('[data-sync-label]').forEach(el => { el.textContent = s.text; });
  document.querySelectorAll('[data-sync-dot]').forEach(el => { el.className = 'dot-badge ' + s.tone; });
  // A sync that brought a new snapshot changes what every screen shows.
  if (lastRev !== (state.snapshot && state.snapshot.rev) || lastPending !== state.pending.length) {
    lastRev = state.snapshot && state.snapshot.rev; lastPending = state.pending.length; dataRev++; scheduleRender();
  }
}
let lastRev = state.snapshot && state.snapshot.rev, lastPending = state.pending.length;

function switchTab(tab, seg) {
  if (!TABS.some(t => t[0] === tab)) return;
  scrollPos[state.tab] = window.scrollY;
  if (seg) state.growSeg = seg;
  const same = state.tab === tab;
  state.tab = tab;
  changed({ silent: true });
  render();
  window.scrollTo(0, same ? 0 : (scrollPos[tab] || 0));
  onScroll();
}

/* ── scroll: top edge blur, compact title, tab bar minimises going down ── */
let lastY = 0;
function onScroll() {
  const y = window.scrollY;
  document.getElementById('edge-top').classList.toggle('on', y > 12);
  document.getElementById('edge-title').classList.toggle('on', y > 58);
  if (y > 90 && y > lastY + 4) tabbar.classList.add('min');
  else if (y < lastY - 4 || y < 40) tabbar.classList.remove('min');
  lastY = y;
}
window.addEventListener('scroll', onScroll, { passive: true });

/* ── workout pill (a running workout is always one tap away) ── */
function updatePill() {
  let pill = document.getElementById('wo-pill');
  // A closing sheet lingers for its slide-out; it no longer counts as open.
  const show = state.workout && !document.querySelector('[data-sheet="workout"]:not(.closing)');
  if (!show) { if (pill) pill.remove(); return; }
  if (!pill) {
    pill = document.createElement('button');
    pill.id = 'wo-pill'; pill.className = 'glass'; pill.dataset.act = 'open-workout';
    pill.style.cssText = 'position:fixed;z-index:49;left:50%;transform:translateX(-50%);bottom:calc(max(var(--safe-b),12px) + 78px);'
      + 'height:40px;padding:0 16px;border-radius:999px;display:flex;align-items:center;gap:8px;font-weight:600;font-size:.88rem;color:#ff9f0a';
    document.body.appendChild(pill);
  }
  pill.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:#ff9f0a;box-shadow:0 0 8px #ff9f0a"></span>'
    + (state.workout.template ? 'New template' : state.workout.edit ? 'Editing a past workout'
      : 'Workout · <span class="num" data-elapsed></span> <span class="num" data-rest></span>');
  tickElapsed(); restTick();
}
function tickElapsed() {
  if (!state.workout) return;
  const s = Math.floor((Date.now() - state.workout.start) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  const txt = (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
  document.querySelectorAll('[data-elapsed]').forEach(el => { el.textContent = txt; });
}
setInterval(tickElapsed, 1000);

/* ── events ── */
const ACT = {
  ...viewActions, ...trainActions, ...sheetActions, ...bodyActions, ...moreActions, ...reviewActions, ...doseActions, ...mindActions, ...routineActions, ...hormoneActions, ...systemActions,
  tab(d) { closeAllSheets(); haptic(); switchTab(d.tab, d.seg); },
  'sheet-close'() { closeSheet(topSheet()); },
};
function closeAllSheets() { while (topSheet()) closeSheet(topSheet()); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  try { fn(el.dataset, el, e); } catch (err) { console.error(err); toast('Something went wrong — ' + err.message); }
});
document.addEventListener('input', e => {
  const el = e.target;
  if (el.matches('[data-set]')) onSetInput(el);
  else if (el.matches('[data-pk-search]')) pickerSearch(el.value);
  else if (el.matches('[data-w-input]')) onWeighInput(el);
  else if (el.matches('[data-tl]')) onTimeline(el);
  else if (el.matches('[data-pl-input]')) onPlatesInput(el);
  else if (el.matches('[data-ds-amt]')) onDoseInput(el);
  else if (onWhatIfInput(el) || onPhotoInput(el)) { /* handled */ }
});
document.addEventListener('change', e => { if (e.target.matches('[data-ph-file]')) onPhotoInput(e.target); });
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.id === 'pair-code') ACT['pair-go']();
  if (e.key === 'Escape' && topSheet()) closeSheet(topSheet());
  // Non-button controls (the figure's muscles) answer Enter and Space like buttons.
  const t = e.target;
  if ((e.key === 'Enter' || e.key === ' ') && t && t.getAttribute && t.getAttribute('role') === 'button' && t.dataset && t.dataset.act && !/BUTTON|INPUT|TEXTAREA/.test(t.tagName)) {
    e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  }
});

/* ── pairing link (#pair=TOKEN, used by the desktop's "open on this PC" link) ── */
(function () {
  const m = /[#&]pair=([a-f0-9]{16,128})/i.exec(location.hash);
  const dv = /[#&]dev=([\w-]{4,64})/.exec(location.hash);
  const hb = /[#&]hub=([^&]+)/.exec(location.hash);
  // #hub= alone comes from the PC's QR code for the GitHub copy: it only names the PC.
  if (hb) { try { const u = new URL(decodeURIComponent(hb[1])); if (/^https?:$/.test(u.protocol)) state.hub = u.origin; } catch (e) { /* ignore a bad address */ } }
  if (m) { state.token = m[1]; if (dv) state.device = dv[1]; }
  // #relay= is the PC's QR code: everything needed to sync through GitHub. Nothing to type.
  const rl = /[#&]relay=([\w-]+)/.exec(location.hash);
  const rp = rl && L.relayUnpack(rl[1]);
  if (rp) {
    const again = state.relay && state.relay.key === rp.k && state.relay.token === rp.t;
    // A link can come from anyone. Moving an existing connection to a different repository would send
    // everything logged from then on to whoever made the link, so that one case asks first.
    const moved = state.relay && state.relay.repo !== rp.r
      && !confirm('This link connects ARK to a different sync repository (' + rp.r + ').\n\nOnly continue if you just scanned the QR code on YOUR PC.');
    if (!again && !moved) {
      state.relay = { repo: rp.r, token: rp.t, key: rp.k, sent: null, etag: null };
      state.token = 'relay'; state.hub = null; state.qrCode = null; state.lastError = null;
      changed({ now: true });
      setTimeout(() => { syncNow(); toast('Connected to ARK ✓'); }, 300);
    }
  }
  // #code= comes from the one QR code on the PC: this app links itself with it (views.js autoConnect).
  const cd = /[#&]code=(\d{6})/.exec(location.hash);
  if (cd && !state.token) state.qrCode = { code: cd[1], at: Date.now() };
  if (m || hb || cd) { history.replaceState(null, '', location.pathname + location.search); changed({ now: true }); }
})();

/* ── the home-screen icon keeps the connection ──
   iOS gives an app added to the Home Screen its own storage, empty — the pairing made in Safari does not
   come along, so it asked for a code again. The only thing that does come along is the address it was
   added from (or the manifest's start_url on newer iOS), so while connected, both carry #relay=. */
function carryRelay() {
  if (!state.relay) return;
  const hash = '#relay=' + L.relayPack({ r: state.relay.repo, t: state.relay.token, k: state.relay.key });
  if (location.hash !== hash) history.replaceState(null, '', location.pathname + location.search + hash);
  const base = new URL('./', location.href).href;
  const man = { name: 'ARK', short_name: 'ARK', start_url: base + hash, scope: base, display: 'standalone', orientation: 'portrait',
    background_color: '#020406', theme_color: '#020406',
    icons: [{ src: base + 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: base + 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }] };
  const link = document.querySelector('link[rel="manifest"]');
  if (link) link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(man));
}
carryRelay();
if (!state.token && onPublicCopy()) setTimeout(() => ACT['pair-scan'] && ACT['pair-scan'](), 600);

/* ── notifications open the tab they are about (?tab= on a cold start, a message when running) ── */
(function () {
  const m = /[?&]tab=([a-z]+)/.exec(location.search);
  if (m && TABS.some(t => t[0] === m[1])) { state.tab = m[1]; history.replaceState(null, '', location.pathname); carryRelay(); }
})();
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', e => {
    const d = e.data || {};
    if (d.type === 'open-tab' && TABS.some(t => t[0] === d.tab)) { closeAllSheets(); switchTab(d.tab); }
    if (d.type === 'open-tab' && d.tab === 'train' && state.workout) openWorkout();
  });
}

/* ── lifecycle ── */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { onVisible(); syncNow(); restTick(); dataRev++; render(); }
  else onHidden();
});
setInterval(() => { if (document.visibilityState === 'visible' && state.token) syncNow(); }, 45000);
window.addEventListener('online', () => scheduleSync(300));

// The simulator (tools/iphone-sim.html) must always run the files on disk, not a cached shell.
if ('serviceWorker' in navigator && /[?&]sim=/.test(location.search)) {
  navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
} else if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

render();
restTick();
if (state.token) syncNow();
window.ARK_MOBILE = { state, render, syncNow, openWorkout };
