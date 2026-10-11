/* Regen Site Commissioning — service worker.
   Scope is this app's own folder only (e.g. /<repo>/), so it never touches other apps on the same github.io site,
   and it takes priority over any service worker another app registered for the whole site.
   Gives offline use on site: the page, icons and the PDF / Excel / font libraries are kept in a cache. */
const CACHE = 'regen-sca-v2';
// every file sits next to index.html (flat), so the site also works when uploaded through GitHub's "Upload files" page
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './apple-touch-icon.png'];
const LIBS = ['https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'];
const LIB_HOSTS = /^(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(u => c.add(u).catch(() => { })));   // a missing file must not stop the app from installing
    await Promise.all(LIBS.map(async u => { try { const r = await fetch(u, { mode: 'no-cors' }); await c.put(u, r); } catch (err) { /* cached later on first use */ } }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('regen-sca-') && k !== CACHE) await caches.delete(k);   // only our own old caches
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url), scope = new URL(self.registration.scope);
  const own = url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
  if (!own && !LIB_HOSTS.test(url.hostname)) return;              // not ours: let the browser handle it
  if (req.mode === 'navigate') {                                      // page: network first, cached copy when offline
    e.respondWith((async () => {
      try { const r = await fetch(req); if (r.ok) (await caches.open(CACHE)).put('./index.html', r.clone()); return r; }
      catch (err) { return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {                                       // files + libraries: cache first, refresh in background
    const c = await caches.open(CACHE), hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
