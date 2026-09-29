/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — core: state, the offline event queue, sync, UI primitives.

   The phone never owns your data. The desktop app does. The phone keeps
   the last snapshot the desktop published plus a queue of changes you made
   here; what you see is the two combined (ARK_LOGIC.projectSnapshot — the
   same code the tests cover). Queued changes survive the app being killed,
   the PC being off, and having no signal.
   ══════════════════════════════════════════════════════════════════════ */

export const L = window.ARK_LOGIC;
const KEY = 'ark-mobile:v1';

/* ── tiny helpers ── */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function uid() {
  // crypto.randomUUID needs a secure context; the home-Wi-Fi URL is plain http.
  const b = new Uint8Array(12); crypto.getRandomValues(b);
  return Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
}
export const today = () => L.dayKey(new Date());
export const shiftDay = (k, d) => L.shiftDayKey(k, d);
export const fmt1 = n => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '');
export function fmtMins(m) {
  m = Math.round(m || 0);
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}
export function fmtDay(k, opts = { weekday: 'short', day: 'numeric', month: 'short' }) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', opts);
}
export function ago(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return Math.round(s / 86400) + ' d ago';
}
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 864e5);
}

/* ── state ── */
const DEFAULTS = {
  v: 1, device: null, deviceName: 'iPhone', token: null, hub: null,
  snapshot: null, pending: [], lastSync: 0, lastError: null,
  settings: { weeklyWorkouts: 3, practiceMins: 30, rest: 90, step: 2.5, theme: 'dark', bar: 20 },
  workout: null, tab: 'today', growSeg: 'skills',
  /** This phone's push subscription, if notifications are on. */
  push: { on: false, endpoint: null },
};
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.v === 1) return { ...DEFAULTS, ...s, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  } catch (e) { /* fall through to a fresh state */ }
  return { ...DEFAULTS, device: uid() };
}
export const state = load();
if (!state.device) state.device = uid();

let ver = 0, viewCache = null, viewVer = -1, saveTm = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }
export function changed(opts = {}) {
  ver++;
  clearTimeout(saveTm);
  if (opts.now) save(); else saveTm = setTimeout(save, 250);
  listeners.forEach(fn => fn(opts));
}
export function save() {
  clearTimeout(saveTm);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Could not save on this phone — storage is full'); }
}
/** The phone's view of your data: last snapshot + queued changes. */
export function view() {
  if (viewVer !== ver) { viewCache = L.projectSnapshot(state.snapshot, state.pending); viewVer = ver; }
  return viewCache;
}
export const paired = () => !!state.token;

/**
 * Record a change: queue it, redraw, and sync soon. `hold` keeps it on the
 * phone for that many ms first, so a delete can be undone before the PC ever
 * sees it (dropPending). Returns the event id.
 */
export function emit(type, data, { hold = 0 } = {}) {
  const ev = { id: uid(), ts: new Date().toISOString(), type, data };
  if (hold) ev.hold = Date.now() + hold;
  state.pending.push(ev);
  changed({ now: true });
  scheduleSync(hold ? hold + 300 : 1200);
  return ev.id;
}
/** Take back a queued change that has not left the phone. False if it already has. */
export function dropPending(id) {
  const i = state.pending.findIndex(e => e.id === id && !e.seq);
  if (i < 0) return false;
  state.pending.splice(i, 1);
  changed({ now: true });
  return true;
}
/** A delete with a five-second Undo. After that, the PC's 📱 Phone panel can still restore it. */
export function emitUndoable(type, data, msg) {
  const id = emit(type, data, { hold: 5500 });
  haptic();
  toast(msg, 'Undo', () => { if (!dropPending(id)) toast('Already on your PC — restore it from 📱 Phone there'); });
  return id;
}
/** Minutes since the PC last published what the phone is showing (null before the first sync). */
export function pcAgeMin() {
  const g = state.snapshot && Date.parse(state.snapshot.generated || '');
  return g ? Math.max(0, Math.round((Date.now() - g) / 60000)) : null;
}
export function pcAsOf() {
  const g = state.snapshot && state.snapshot.generated ? new Date(state.snapshot.generated) : null;
  if (!g || isNaN(g)) return '';
  const sameDay = L.dayKey(g) === today();
  return (sameDay ? 'today ' : g.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ')
    + g.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/* ── sync ── */
export const hubBase = () => (state.hub || location.origin).replace(/\/+$/, '');
let inflight = false, again = false, syncTm = null, followTm = null;
export const syncState = { busy: false };

export function scheduleSync(ms = 1500) {
  clearTimeout(syncTm);
  syncTm = setTimeout(() => syncNow(), ms);
}

async function post(path, body, auth = true, keepalive = false) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const headers = { 'content-type': 'application/json' };
    if (auth) headers.authorization = 'Bearer ' + state.token;
    // keepalive lets the request finish after iOS backgrounds the page (the rest-timer push).
    const res = await fetch(hubBase() + path, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal, cache: 'no-store', keepalive });
    let json = null; try { json = await res.json(); } catch (e) { /* non-JSON error page */ }
    return { status: res.status, json };
  } finally { clearTimeout(t); }
}

export async function syncNow({ keepalive = false } = {}) {
  if (!state.token) return false;
  if (inflight) { again = true; return false; }
  inflight = true; syncState.busy = true; changed({ status: true });
  let ok = false;
  try {
    const now = Date.now();
    const held = state.pending.filter(e => !e.seq && e.hold > now);
    if (held.length) scheduleSync(Math.min(...held.map(e => e.hold)) - now + 300);
    if (state.relay) { ok = await relaySync(now); return ok; }
    const events = state.pending.filter(e => !e.seq && !(e.hold > now)).map(({ id, ts, type, data }) => ({ id, ts, type, data }));
    const { status, json } = await post('/api/sync', {
      device: state.device, name: state.deviceName,
      haveRev: (state.snapshot && state.snapshot.rev) || 0, events,
    }, true, keepalive);
    if (status === 401) { state.lastError = 'unpaired'; }
    else if (status !== 200 || !json) { state.lastError = 'hub error ' + status; }
    else {
      const seqs = new Map((json.accepted || []).map(a => [a.id, a.seq]));
      state.pending.forEach(e => { if (!e.seq && seqs.has(e.id)) e.seq = seqs.get(e.id); });
      if (json.snapshot) state.snapshot = json.snapshot;
      const applied = (state.snapshot && state.snapshot.appliedSeq) || 0;
      state.pending = L.prunePending(state.pending, applied);
      state.lastSync = Date.now(); state.lastError = null; ok = true;
      learnHome();
      // Sent but not yet folded in by the desktop: look again shortly.
      clearTimeout(followTm);
      if (state.pending.some(e => e.seq)) followTm = setTimeout(syncNow, 5000);
    }
  } catch (e) {
    state.lastError = navigator.onLine === false ? 'offline' : onPublicCopy() ? 'away' : 'unreachable';
  } finally {
    inflight = false; syncState.busy = false;
    changed({ now: true, status: true });
    if (again) { again = false; scheduleSync(300); }
  }
  return ok;
}

/* ── one address for good ──
   Opened from a bare IP (http://192.168.x.y:7788) the app lives at an address the router can change,
   and a new address is a new app on the phone (new storage, pairing again). The hub reports the PC's
   own name (http://<computer>.local:7788), which follows the PC to any IP on the home network. */
let homeChecked = false;
async function learnHome() {
  if (homeChecked) return; homeChecked = true;
  try {
    const r = await fetch(hubBase() + '/api/ping', { cache: 'no-store' });
    const j = await r.json();
    const home = j && typeof j.home === 'string' ? j.home : null;
    if (home !== (state.home || null)) { state.home = home; changed({ now: true }); }
  } catch (e) { /* offline — next time */ }
}
/** The same app at the permanent address, carrying this phone's pairing — or null if already there. */
export function homeMove() {
  if (!state.home || !state.token || /[?&]sim=/.test(location.search)) return null;
  let o; try { o = new URL(state.home); } catch (e) { return null; }
  if (o.origin === location.origin || !/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname)) return null;
  return { host: o.host, url: o.origin + '/#pair=' + state.token + '&dev=' + encodeURIComponent(state.device) };
}

/* ── open anywhere: the copy hosted on GitHub Pages ──
   Served from the PC over plain http, the app cannot open while the PC is off: iPhone keeps an
   offline copy only for secure (https) pages. The same files are published on GitHub Pages; that
   copy talks to the PC over https (port 7789) with ARK's own certificate, which the phone installs
   once. Checking the https ping from here tells whether the certificate is trusted yet. */
export const PUBLIC_HOME = 'https://blackcodie.github.io/ark/';
export const onPublicCopy = () => location.origin + '/' === new URL(PUBLIC_HOME).origin + '/' ;
export function anywhere() {
  if (location.protocol !== 'http:' || !state.token || /[?&]sim=/.test(location.search) || !location.port) return null;
  const https = 'https://' + location.hostname + ':' + (Number(location.port) + 1);
  return { https, ca: location.origin + '/ark-ca.crt',
    url: PUBLIC_HOME + '#pair=' + state.token + '&dev=' + encodeURIComponent(state.device) + '&hub=' + encodeURIComponent(https) };
}
export const caState = { trusted: null };
export async function checkCa() {
  const a = anywhere(); if (!a) return;
  try { const r = await fetch(a.https + '/api/ping', { cache: 'no-store' }); caState.trusted = r.ok; }
  catch (e) { caState.trusted = false; }
  changed();
}

/* ── sync through GitHub (logic/src/relay.ts) ──
   Set up by the PC's QR code (#relay=…): a private repository, access and an encryption key. This
   phone writes every event not yet acknowledged to its own branch and reads the PC's snapshot;
   the PC lists the ids it applied (relayApplied) and those leave the queue. Works on any network. */
async function relaySync(now) {
  const R = state.relay, c = { repo: R.repo, token: R.token };
  try {
    const events = state.pending.filter(e => !(e.hold > now)).map(({ id, ts, type, data }) => ({ id, ts, type, data }));
    const sig = JSON.stringify(events);
    if (sig !== R.sent && (events.length || R.sent)) {
      await L.relayWrite(c, 'phone-' + state.device, 'inbox.json', await L.relayEncrypt(R.key, { events, name: state.deviceName }));
      R.sent = sig;
    }
    const r = await L.relayRead(c, 'pc', 'snapshot.json', R.etag);
    if (r && r.text) { state.snapshot = await L.relayDecrypt(R.key, r.text); R.etag = r.etag; }
    const done = new Set((state.snapshot && state.snapshot.relayApplied) || []);
    const before = state.pending.length;
    state.pending = state.pending.filter(e => !done.has(e.id));
    if (state.pending.length !== before) R.sent = null;
    state.lastSync = Date.now(); state.lastError = r ? null : 'waiting-pc';
    // the PC applies within ~15 s; look again soon while anything is waiting
    clearTimeout(followTm);
    if (state.pending.length) followTm = setTimeout(syncNow, 20000);
    return true;
  } catch (e) {
    state.lastError = /unauthorized|401/.test(String(e && e.message)) ? 'unpaired' : navigator.onLine === false ? 'offline' : 'relay';
    return false;
  }
}

/** Exchange the 6-digit code shown on the PC for this phone's token. */
/** What the person typed as the PC's address → the hub URL. On the GitHub copy it is always https:7789. */
export function hubFrom(input) {
  const s = String(input || '').trim(); if (!s) return null;
  if (onPublicCopy()) {
    const host = s.replace(/^[a-z]+:\/\//i, '').replace(/[:/].*$/, '');
    return host ? 'https://' + (/\./.test(host) ? host : host + '.local') + ':7789' : null;
  }
  return /^https?:\/\//.test(s) ? s.replace(/\/+$/, '') : 'http://' + s.replace(/\/+$/, '');
}
export async function pair(code, hub) {
  if (hub) state.hub = hubFrom(hub) || state.hub;
  try {
    const { status, json } = await post('/api/pair', { code: String(code).replace(/\D/g, ''), device: state.device, name: state.deviceName }, false);
    if (status === 200 && json && json.token) {
      state.token = json.token; state.lastError = null; changed({ now: true });
      await syncNow();
      return { ok: true };
    }
    return { ok: false, msg: status === 429 ? 'Too many tries — make a new code on the PC.' : 'That code did not match. Codes last 10 minutes.' };
  } catch (e) {
    return { ok: false, msg: onPublicCopy()
      ? 'Could not reach your PC securely at ' + hubBase() + '. Install ARK\'s certificate (step 1), be on home Wi-Fi, and keep ARK open on the PC.'
      : 'Could not reach ARK at ' + hubBase() + '. Is the desktop app open?' };
  }
}
export function unpair() {
  state.token = null; state.snapshot = null; state.lastSync = 0; state.lastError = null;
  changed({ now: true });
}

/** Human status line for the sync indicator. */
export function syncLabel() {
  const n = state.pending.filter(e => !e.seq).length, waiting = state.pending.length;
  if (!state.token) return { tone: 'err', text: 'Not connected' };
  if (syncState.busy) return { tone: '', text: 'Syncing…' };
  if (state.lastError === 'unpaired') return { tone: 'err', text: 'Pairing expired — reconnect' };
  if (state.lastError === 'waiting-pc') return { tone: '', text: 'Connected — waiting for your PC to upload (open ARK on it)' };
  if (state.lastError === 'relay') return { tone: 'err', text: (n ? n + ' saved on this phone · ' : '') + 'GitHub not reachable — retrying' };
  if (state.lastError === 'away') return { tone: '', text: (n ? n + ' saved on this phone · ' : '') + 'syncs at home, with ARK open' };
  if (state.lastError) return { tone: 'err', text: (n ? n + ' change' + (n === 1 ? '' : 's') + ' waiting · ' : '') + 'PC not reachable' };
  if (waiting) return { tone: '', text: 'Saving to your PC…' };
  return { tone: 'ok', text: 'Synced ' + ago(state.lastSync) };
}

/* ── appearance ── */
// Dark is ARK. Light is opt-in (Settings → Appearance); System follows iOS.
const mqLight = window.matchMedia ? matchMedia('(prefers-color-scheme: light)') : null;
export function applyTheme() {
  const pref = state.settings.theme || 'dark';
  const light = pref === 'light' || (pref === 'system' && mqLight && mqLight.matches);
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  const bg = light ? '#eef1f5' : '#020406';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', light ? 'light' : 'dark');
}
mqLight && mqLight.addEventListener && mqLight.addEventListener('change', () => { if (state.settings.theme === 'system') applyTheme(); });

/* ── safe areas ── */
// iOS normally fills env(safe-area-inset-*). Some launch paths (an older
// Home Screen install, a web app opened from a link) report 0 on phones with a
// notch or Dynamic Island, which puts controls under the status bar and the
// home indicator. Measure what CSS got; if it is 0 where the hardware says it
// cannot be, supply the real values. The iPhone simulator sets them itself.
export const standalone = navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
(function safeAreas() {
  if (/[?&]sim=/.test(location.search)) return;
  const iOS = /iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!iOS || !standalone || !document.body) return;
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(p);
  const cs = getComputedStyle(p), top = parseFloat(cs.paddingTop) || 0, bot = parseFloat(cs.paddingBottom) || 0;
  p.remove();
  const tall = Math.max(screen.height, screen.width) >= 812;      // every Face ID iPhone
  if (!tall) return;
  const island = Math.max(screen.height, screen.width) >= 852;
  const r = document.documentElement.style;
  if (top < 20) r.setProperty('--safe-t', (island ? 59 : 47) + 'px');
  if (bot < 10) r.setProperty('--safe-b', '34px');
})();

/* ── keyboard ── */
// iOS does not shrink the layout for the keyboard; a bottom sheet would sit
// under it. --kb is the keyboard's height, and the focused field is kept in view.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--kb', (kb > 80 ? kb : 0) + 'px');
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
}
document.addEventListener('focusin', e => {
  const el = e.target;
  if (!el || !/INPUT|TEXTAREA|SELECT/.test(el.tagName) || !el.closest('.sheet')) return;
  setTimeout(() => { try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (x) { /* old Safari */ } }, 320);
});

/* ── clipboard (works on the plain-http Wi-Fi address too) ── */
export async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* no clipboard */ }
  ta.remove();
  return ok;
}

/* ── haptics ── */
// iOS Safari has no vibrate API; toggling a hidden <input switch> is the one
// thing that produces a system haptic (iOS 18+). Elsewhere it is a no-op.
let hapticEl = null;
export function haptic() {
  try {
    if (navigator.vibrate) { navigator.vibrate(8); return; }
    if (!hapticEl) {
      hapticEl = document.createElement('label');
      hapticEl.setAttribute('aria-hidden', 'true');
      hapticEl.style.display = 'none';
      const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', '');
      hapticEl.appendChild(i); document.body.appendChild(hapticEl);
    }
    hapticEl.click();
  } catch (e) { /* no haptics available */ }
}

/* ── sound (rest timer) ── */
let actx = null;
export function unlockAudio() {
  try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {}
}
export function chime() {
  if (!actx) return;
  const t = actx.currentTime;
  [880, 1320].forEach((f, i) => {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * .16); g.gain.linearRampToValueAtTime(.22, t + i * .16 + .02);
    g.gain.exponentialRampToValueAtTime(.0001, t + i * .16 + .5);
    o.connect(g).connect(actx.destination); o.start(t + i * .16); o.stop(t + i * .16 + .55);
  });
}

/* ── toast ── */
let toastTm = null;
export function toast(msg, action, fn) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(action) + '</button>' : '');
  if (action) t.querySelector('button').onclick = () => { t.classList.remove('on'); fn && fn(); };
  t.classList.add('on');
  clearTimeout(toastTm);
  toastTm = setTimeout(() => t.classList.remove('on'), action ? 5000 : 2400);
}

/* ── sheets ── */
const sheetStack = [];
/**
 * Open a bottom sheet. `render()` returns its HTML and is called again by
 * `refresh()`; `onClose` runs when it is dismissed any way.
 */
export function openSheet({ id, title, render, full = false, left = null, right = null, onClose }) {
  const root = document.getElementById('sheet-root');
  const bg = document.createElement('div'); bg.className = 'sheet-bg';
  const el = document.createElement('section');
  el.className = 'sheet glass' + (full ? ' full' : '');
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', title || '');
  el.dataset.sheet = id || '';
  root.append(bg, el);
  const s = { id, el, bg, render, onClose, full, title, left, right };
  s.refresh = () => {
    const body = el.querySelector('.sheet-body');
    const top = body ? body.scrollTop : 0;
    el.innerHTML = '<div class="grab"></div><header class="sheet-h">'
      + (s.left || '<span style="width:44px"></span>')
      + '<h3>' + esc(s.title || '') + '</h3>'
      + (s.right || '<button class="circle sm btn-glass" data-act="sheet-close" aria-label="Close">' + icon('x', 16) + '</button>')
      + '</header><div class="sheet-body">' + render() + '</div>';
    const nb = el.querySelector('.sheet-body'); if (nb) nb.scrollTop = top;
  };
  s.close = () => closeSheet(s);
  s.refresh();
  sheetStack.push(s);
  document.documentElement.classList.add('lock');
  requestAnimationFrame(() => requestAnimationFrame(() => { bg.classList.add('on'); el.classList.add('on'); }));
  bg.addEventListener('click', () => s.close());
  dragToDismiss(s);
  return s;
}
export function topSheet() { return sheetStack[sheetStack.length - 1] || null; }
/** Redraw open sheets - but never one you are typing in; that would drop the keyboard. */
export function refreshSheets() {
  const a = document.activeElement, typing = a && /INPUT|TEXTAREA/.test(a.tagName);
  sheetStack.forEach(s => {
    if (typing && s.el.contains(a)) { s.dirty = true; return; }
    s.dirty = false; s.refresh();
  });
}
document.addEventListener("focusout", () => setTimeout(() => {
  const a = document.activeElement;
  if (a && /INPUT|TEXTAREA/.test(a.tagName)) return;
  sheetStack.forEach(s => { if (s.dirty) { s.dirty = false; s.refresh(); } });
}, 0));
export function closeSheet(s = topSheet()) {
  if (!s) return;
  const i = sheetStack.indexOf(s); if (i >= 0) sheetStack.splice(i, 1);
  s.el.classList.remove('on'); s.bg.classList.remove('on'); s.el.classList.add('closing');
  setTimeout(() => { s.el.remove(); s.bg.remove(); }, 450);
  if (!sheetStack.length) document.documentElement.classList.remove('lock');
  s.onClose && s.onClose();
}
function dragToDismiss(s) {
  let y0 = null, dy = 0;
  s.el.addEventListener('pointerdown', e => {
    const onHeader = e.target.closest('.grab,.sheet-h');
    const body = s.el.querySelector('.sheet-body');
    if (!onHeader && !(body && body.scrollTop <= 0 && e.target.closest('.sheet-body') && e.pointerType === 'touch')) return;
    if (e.target.closest('button,input,textarea,select')) return;
    y0 = e.clientY; dy = 0; s.el.style.transition = 'none';
  });
  window.addEventListener('pointermove', e => {
    if (y0 === null) return;
    dy = Math.max(0, e.clientY - y0);
    s.el.style.transform = (s.el.style.transform.includes('-50%') ? 'translateX(-50%) ' : '') + `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null; s.el.style.transition = ''; s.el.style.transform = '';
    if (dy > 110) s.close();
  };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}

/* ── icons (SF-Symbol-like line icons) ── */
const P = {
  hex: '<path d="M12 2.9 20.1 7.5v9L12 21.1 3.9 16.5v-9Z"/><path d="M12 8.2 15.4 10.1v3.8L12 15.8l-3.4-1.9v-3.8Z" opacity=".55"/>',
  dumbbell: '<rect x="4.2" y="7" width="3.3" height="10" rx="1.3"/><rect x="16.5" y="7" width="3.3" height="10" rx="1.3"/><path d="M7.5 12h9M2.4 10v4M21.6 10v4"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.4 2.6 2.6 5-5.4"/>',
  heart: '<path d="M12 20s-7.6-4.5-7.6-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.6 2.6C19.6 15.5 12 20 12 20Z"/><path d="M6.4 12.3h2.9l1.3-2.3 2.2 4.5 1.3-2.2h3.4"/>',
  sprout: '<path d="M12 21v-8.5"/><path d="M12 12.5c0-4.2 2.9-7.3 8.2-7.3 0 4.2-3 7.3-8.2 7.3Z"/><path d="M12 15c0-3.3-2.4-5.7-6.7-5.7 0 3.4 2.4 5.7 6.7 5.7Z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  chev: '<path d="m9.5 6 6 6-6 6"/>',
  down: '<path d="m6 9.5 6 6 6-6"/>',
  tick: '<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>',
  scale: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 9.5a5 5 0 0 1 7 0l-2.2 2.3"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  bolt: '<path d="M13 2.8 5.5 13.3h5.8L10.5 21l8-10.6h-5.9Z"/>',
  drop: '<path d="M12 3.2s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z"/>',
  flame: '<path d="M12 21c3.9 0 6.5-2.6 6.5-6.1 0-4.6-4.3-6.4-4.8-11-3 1.7-4.9 4.6-4.4 8-1-.6-1.6-1.6-1.8-2.7-1.4 1.5-2 3.5-2 5.7C5.5 18.4 8.1 21 12 21Z"/>',
  timer: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4.2l2.6 1.6M9.5 2.8h5"/>',
  note: '<path d="M12.5 4.5H6.8A2.3 2.3 0 0 0 4.5 6.8v10.4a2.3 2.3 0 0 0 2.3 2.3h10.4a2.3 2.3 0 0 0 2.3-2.3v-5.7"/><path d="m17.3 3.8 2.9 2.9-7.4 7.4-3.6.7.7-3.6Z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5"/>',
  meat: '<path d="M14.5 4.5c3 0 5 2.4 5 5.2 0 4.8-5.3 8.8-10.3 8.8-2.4 0-4.7-1.4-4.7-4.2 0-3.4 3.4-3.6 4.3-6.3.8-2.1 2.8-3.5 5.7-3.5Z"/><circle cx="14.3" cy="9.6" r="1.6"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  wifi: '<path d="M4 9.5a12 12 0 0 1 16 0M7 12.7a7.6 7.6 0 0 1 10 0M10 15.8a3.2 3.2 0 0 1 4 0"/><circle cx="12" cy="19" r=".9" fill="currentColor"/>',
  trash: '<path d="M5 7h14M10 7V4.8h4V7M7 7l.8 12.2h8.4L17 7"/>',
  pencil: '<path d="M4.5 19.5 5.4 15.6 15.8 5.2a2 2 0 0 1 2.9 0l.1.1a2 2 0 0 1 0 2.9L8.4 18.6Z"/><path d="m14 7 3 3"/>',
  bell: '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.6H5Z"/><path d="M10 20.2a2.2 2.2 0 0 0 4 0"/>',
  link: '<path d="M10.2 13.8a3.8 3.8 0 0 0 5.4 0l3-3a3.8 3.8 0 0 0-5.4-5.4l-1 1"/><path d="M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-3 3a3.8 3.8 0 0 0 5.4 5.4l1-1"/>',
  chart: '<path d="M4 19.5h16"/><path d="m5.5 15 4-4.5 3.5 3 5.5-6.5"/>',
  plates: '<rect x="3" y="10.5" width="18" height="3" rx="1"/><rect x="6" y="6" width="2.6" height="12" rx="1"/><rect x="9.2" y="7.5" width="2.2" height="9" rx="1"/><rect x="15.4" y="6" width="2.6" height="12" rx="1"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6.8a2.3 2.3 0 0 0-2.3-2.3H6.8a2.3 2.3 0 0 0-2.3 2.3v6.4a2.3 2.3 0 0 0 2.3 2.3h1.7"/>',
  dots: '<circle cx="6" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18" cy="12" r="1.3" fill="currentColor"/>',
  book: '<path d="M5 4.5h9.5a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3Z"/><path d="M5 16.5a3 3 0 0 1 3-3h9.5"/>',
  brain: '<path d="M12 5.2a3 3 0 0 0-5.5-1A3.2 3.2 0 0 0 3.6 9a3.3 3.3 0 0 0 .7 5.6 3.3 3.3 0 0 0 3.5 4.9A2.8 2.8 0 0 0 12 18.8"/><path d="M12 5.2a3 3 0 0 1 5.5-1A3.2 3.2 0 0 1 20.4 9a3.3 3.3 0 0 1-.7 5.6 3.3 3.3 0 0 1-3.5 4.9A2.8 2.8 0 0 1 12 18.8Z"/><path d="M12 5.2v13.6M7.2 9.5c1.2 0 2.2.7 2.6 1.8M16.8 9.5c-1.2 0-2.2.7-2.6 1.8M7.6 14.6c.9-.6 2-.6 2.9 0M16.4 14.6c-.9-.6-2-.6-2.9 0"/>',
  pill: '<rect x="3.5" y="8.2" width="17" height="7.6" rx="3.8" transform="rotate(-35 12 12)"/><path d="m9.6 8.6 4.8 6.8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.8v2M12 19.2v2M21.2 12h-2M4.8 12h-2M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4M18.5 18.5l-1.4-1.4M6.9 6.9 5.5 5.5"/>',
};
export function icon(name, size = 22, sw = 1.9) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

/* ── charts ── */
/** Concentric activity rings. rings = [{v:0..1, c}] outermost first. */
export function ringsSvg(rings, size = 132) {
  const sw = size * 0.105, gap = sw * 0.28, c = size / 2;
  let out = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Today's progress">`;
  rings.forEach((r, i) => {
    const rad = c - sw / 2 - i * (sw + gap), len = 2 * Math.PI * rad, v = Math.max(0, Math.min(1, r.v || 0));
    out += `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="${r.c}" stroke-opacity=".18" stroke-width="${sw}"/>`;
    out += `<circle cx="${c}" cy="${c}" r="${rad}" fill="none" stroke="${r.c}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - v)}" transform="rotate(-90 ${c} ${c})"
      style="transition:stroke-dashoffset 1s cubic-bezier(.22,.8,.26,1)"/>`;
  });
  return out + '</svg>';
}
export function ringSvg(v, c, size = 64, sw = 7, label = '') {
  const r = size / 2 - sw / 2, len = 2 * Math.PI * r, val = Math.max(0, Math.min(1, v || 0));
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${c}" stroke-opacity=".18" stroke-width="${sw}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${len}" stroke-dashoffset="${len * (1 - val)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    ${label ? `<text x="50%" y="53%" text-anchor="middle" dominant-baseline="middle" fill="currentColor" font-size="${size * .3}" font-weight="700" font-family="ui-rounded,system-ui">${label}</text>` : ''}
  </svg>`;
}
/** Area sparkline over real points only; gaps are not interpolated into data. */
export function sparkSvg(points, color = 'var(--accent)', h = 64) {
  if (points.length < 2) return '';
  const W = 320, pad = 6, ys = points.map(p => p.y);
  const lo = Math.min(...ys), hi = Math.max(...ys), rng = hi - lo || 1;
  const x0 = points[0].t, x1 = points[points.length - 1].t, xr = x1 - x0 || 1;
  const X = t => pad + (t - x0) / xr * (W - pad * 2), Y = y => h - pad - (y - lo) / rng * (h - pad * 2 - 6);
  const line = points.map((p, i) => (i ? 'L' : 'M') + X(p.t).toFixed(1) + ',' + Y(p.y).toFixed(1)).join(' ');
  const id = 'g' + Math.random().toString(36).slice(2, 7);
  const last = points[points.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${line} L${X(x1).toFixed(1)},${h} L${X(x0).toFixed(1)},${h} Z" fill="url(#${id})"/>
    <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${X(last.t).toFixed(1)}" cy="${Y(last.y).toFixed(1)}" r="3.5" fill="${color}"/>
  </svg>`;
}
export function barsSvg(vals, color = 'var(--accent)', h = 70, labels = []) {
  const W = 320, n = vals.length, hi = Math.max(1, ...vals), bw = W / n;
  let s = `<svg viewBox="0 0 ${W} ${h + 16}" style="width:100%;height:${h + 16}px" preserveAspectRatio="none">`;
  vals.forEach((v, i) => {
    const bh = v > 0 ? Math.max(3, v / hi * h) : 0;
    s += `<rect x="${(i * bw + bw * .2).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw * .6).toFixed(1)}" height="${bh.toFixed(1)}" rx="3" fill="${color}" opacity="${i === n - 1 ? 1 : .55}"/>`;
    if (!v) s += `<rect x="${(i * bw + bw * .2).toFixed(1)}" y="${h - 2}" width="${(bw * .6).toFixed(1)}" height="2" rx="1" fill="rgba(255,255,255,.12)"/>`;
    if (labels[i]) s += `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${h + 13}" text-anchor="middle" font-size="9.5" fill="rgba(235,240,245,.4)" font-family="system-ui">${labels[i]}</text>`;
  });
  return s + '</svg>';
}
