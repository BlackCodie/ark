/* ══════════════════════════════════════════════════════════════════════
   ARK Mobile — weather on Today (Open-Meteo, free, no key; logic/weather.ts).
   Your location stays on this phone, rounded to ~1 km before it is sent;
   nothing else is. Refreshed every 30 minutes while ARK is open.
   ══════════════════════════════════════════════════════════════════════ */
import { L, state, changed, esc, icon, toast, haptic, openSheet, closeSheet, topSheet } from './core.js';

const FRESH = 30 * 60e3;
let busy = false;
const loc = () => (state.settings.weather && state.settings.weather.lat != null ? state.settings.weather : null);
async function refresh(force = false) {
  const p = loc(); if (!p || busy) return;
  const c = state.weatherCache;
  if (!force && c && Date.now() - c.t < FRESH && c.lat === p.lat && c.lon === p.lon) return;
  busy = true;
  try {
    const r = await fetch(L.weatherUrl(p.lat, p.lon), { cache: 'no-store' });
    const W = L.parseWeather(await r.json());
    if (W) { state.weatherCache = { t: Date.now(), lat: p.lat, lon: p.lon, w: W }; changed({ now: true }); }
  } catch (e) { /* offline — the last reading stays */ }
  busy = false;
}
export function weatherCard() {
  const p = loc();
  if (!p) return `<section class="card frost wx wx-set"><div class="wx-h"><span class="wx-ic">⛅</span><div><b>Weather</b><div class="sub">Set your location once — ARK reads the day's weather and what it means for your body.</div></div></div>
    <div class="row" style="gap:8px;margin-top:10px"><button class="btn sm btn-prominent" data-act="wx-here">${icon('target', 15)} Use my location</button><button class="btn sm btn-glass" data-act="wx-city">Search a city</button></div></section>`;
  const c = state.weatherCache, W = c && c.lat === p.lat && c.lon === p.lon ? c.w : null;
  setTimeout(() => refresh(), 0);
  if (!W) return `<section class="card frost wx"><div class="sub">Loading the weather for ${esc(p.name || 'your location')}…</div></section>`;
  const old = Date.now() - c.t > 3 * FRESH;
  return `<section class="card frost wx" data-act="wx-sheet" role="button" tabindex="0" aria-label="Weather details">
    <div class="wx-top"><span class="wx-big">${W.icon}</span><div class="wx-t"><b class="num">${W.temp}°</b><span>${esc(W.text)}<br><small>feels ${W.feels}° · ${esc(p.name || 'here')}</small></span></div>
      <div class="wx-hl num">${W.hi != null ? '↑' + W.hi + '°' : ''}<br>${W.lo != null ? '↓' + W.lo + '°' : ''}</div></div>
    <div class="wx-hours">${W.hours.slice(0, 8).map(h => `<span><small>${h.t.slice(0, 2)}</small>${h.icon}<b class="num">${h.temp}°</b>${h.rain ? `<em>${h.rain}%</em>` : '<em></em>'}</span>`).join('')}</div>
    <div class="wx-meta">${W.rain != null ? `<span>☔ ${W.rain}%</span>` : ''}${W.uv != null ? `<span>UV ${W.uv}</span>` : ''}<span>💨 ${W.wind} km/h</span>${W.sunrise ? `<span>🌅 ${W.sunrise}</span>` : ''}${W.sunset ? `<span>🌇 ${W.sunset}</span>` : ''}</div>
    ${W.note ? `<div class="wx-note">${esc(W.note)}</div>` : ''}${old ? '<div class="sub" style="margin-top:6px">Offline — showing the last reading.</div>' : ''}</section>`;
}
function citySheet() {
  let results = [], q = '';
  const s = openSheet({
    id: 'wx-city', title: 'Weather location',
    render: () => `<input class="inp" type="search" placeholder="City" value="${esc(q)}" data-wx-q autocomplete="off" enterkeyhint="search">
      <button class="btn btn-prominent block" style="margin-top:10px" data-act="wx-search">Search</button>
      ${results.length ? `<section class="list frost" style="margin-top:12px">${results.map((r, i) => `<button class="li" data-act="wx-pick" data-i="${i}"><span class="tx"><div class="tt">${esc(r.name)}</div><div class="st">${esc([r.admin1, r.country].filter(Boolean).join(', '))}</div></span></button>`).join('')}</section>` : ''}
      <button class="btn btn-glass block" style="margin-top:12px" data-act="wx-here">${icon('target', 15)} Use my location instead</button>
      ${loc() ? `<button class="btn btn-danger block" style="margin-top:10px" data-act="wx-off">Remove weather</button>` : ''}
      <p class="sub" style="line-height:1.5;margin-top:12px">From Open-Meteo. Only the place you pick (rounded to ~1 km) is sent — stored on this phone.</p>`,
  });
  s.search = async () => {
    q = (document.querySelector('[data-wx-q]') || {}).value || '';
    if (!q.trim()) return;
    try { const r = await fetch(L.geocodeUrl(q)); const j = await r.json(); results = (j.results || []).slice(0, 5); }
    catch (e) { toast('No connection'); }
    if (!results.length) toast('No place found');
    s.refresh();
  };
  s.results = () => results;
}
function setLoc(lat, lon, name) {
  state.settings.weather = { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100, name };
  state.weatherCache = null; changed({ now: true }); refresh(true);
}
export const actions = {
  'wx-here'() {
    if (!navigator.geolocation) { toast('Location is not available — search a city'); return; }
    navigator.geolocation.getCurrentPosition(p => { setLoc(p.coords.latitude, p.coords.longitude, 'Here'); const t = topSheet(); if (t && t.id === 'wx-city') closeSheet(t); haptic(); },
      () => toast('Location was not allowed — search a city instead'), { maximumAge: 3600e3, timeout: 10000 });
  },
  'wx-city'() { citySheet(); },
  'wx-search'() { const t = topSheet(); if (t && t.search) t.search(); },
  'wx-pick'(d) { const t = topSheet(); const r = t && t.results ? t.results()[Number(d.i)] : null; if (!r) return; setLoc(r.latitude, r.longitude, r.name); closeSheet(t); haptic(); },
  'wx-off'() { delete state.settings.weather; state.weatherCache = null; const t = topSheet(); if (t) closeSheet(t); changed({ now: true }); },
  'wx-sheet'() { citySheet(); },
};
export function onWeatherKey(e) {
  if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-wx-q]')) { const t = topSheet(); if (t && t.search) t.search(); return true; }
  return false;
}
