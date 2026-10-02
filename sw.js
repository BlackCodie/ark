/* ARK Mobile service worker.
   The app shell is cached so the app opens with no signal at the gym. Your data
   is never cached here — it lives in the page's own storage and the sync API is
   always network-only. Bump VERSION whenever a shell file changes. */
const VERSION = 'ark-mobile-29';
const SHELL = [
  'index.html', 'app.css', 'body.css', 'ark-logic.js', 'body-data.js', 'manifest.webmanifest',
  'js/app.js', 'js/core.js', 'js/views.js', 'js/train.js', 'js/sheets.js', 'js/body.js', 'js/more.js', 'js/review.js',
  'js/doses.js', 'js/mind.js', 'js/routines.js', 'js/hormones.js', 'js/brain-art.js', 'js/system.js', 'js/daily.js', 'js/lymph.js', 'vendor/jsQR.js', 'ark-engine.js',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon.svg',
];

self.addEventListener('install', e => {
  // File by file: one missing asset must not cost the whole offline shell.
  e.waitUntil(caches.open(VERSION)
    .then(c => Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: 'reload' })))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Stale-while-revalidate: open instantly from cache, pick up a new version next launch.
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true })
      || (e.request.mode === 'navigate' ? await cache.match('index.html') : null);
    const net = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  }));
});

/* Notifications. Your PC encrypts each one for this phone and Apple delivers
   it; only this worker can read it. iOS requires every push to show something. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ARK', {
    body: d.body || '', tag: d.tag || 'ark', renotify: d.tag === 'rest',
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { tab: String(d.url || '').replace(/^#/, '') },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const tab = (e.notification.data || {}).tab || '';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list[0];
    if (c) { c.postMessage({ type: 'open-tab', tab }); return c.focus(); }
    return self.clients.openWindow('./' + (tab ? '?tab=' + encodeURIComponent(tab) : ''));
  }));
});
