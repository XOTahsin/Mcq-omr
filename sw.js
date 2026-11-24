// Offline support: app files are network-first (so updates show up), libraries/fonts are cache-first.
const CACHE = 'omr-practice-v2.0.0';
const APP = ['./', './index.html', './css/style.css', './js/app.js', './js/scanner.js', './js/cropper.js', './js/i18n.js', './js/icons.js', './js/store.js', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];
const LIB = ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all([...APP, ...LIB].map(u => c.add(u).catch(() => {})))));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== CACHE).map(x => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('./index.html'))));
  } else if (/jsdelivr|unpkg|fonts\.(googleapis|gstatic)/.test(u.host)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; })));
  }
});
