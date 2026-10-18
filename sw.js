/* Alpha Fellowship service worker.
   - HTML: network-first (users always get the newest app, falls back offline)
   - Same-origin static files + fonts + supabase-js lib: stale-while-revalidate
   - Supabase API / AI API calls are never cached                              */
const VERSION = 'af-v1';
const SHELL = 'shell-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;
const PRECACHE = ['./', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, RUNTIME].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const NEVER_CACHE = [/supabase\.co/, /googleapis\.com\/v1/, /generativelanguage/, /aiplatform/];
const CACHEABLE_CROSS = [/fonts\.googleapis\.com/, /fonts\.gstatic\.com/, /cdn\.jsdelivr\.net/, /i\.ytimg\.com/];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (NEVER_CACHE.some((r) => r.test(url.href))) return;

  // Page navigations: network first, cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./').then((r) => r || caches.match(req)))
    );
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_CROSS.some((r) => r.test(url.href))) return;

  // Stale-while-revalidate
  e.respondWith(
    caches.open(RUNTIME).then((cache) =>
      cache.match(req).then((hit) => {
        const net = fetch(req)
          .then((res) => {
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit);
        return hit || net;
      })
    )
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
