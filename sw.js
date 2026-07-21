const VARASTO = 'parkkakorpi-v2';
const TIEDOSTOT = ['./', './index.html', './app.js', './manifest.json', './kartta.jpg'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VARASTO);
    await Promise.allSettled(TIEDOSTOT.map(t => c.add(t)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const nimet = await caches.keys();
    await Promise.all(nimet.filter(n => n !== VARASTO).map(n => caches.delete(n)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith((async () => {
    const osuma = await caches.match(e.request, { ignoreSearch: true });
    if (osuma) return osuma;
    try {
      const vastaus = await fetch(e.request);
      if (vastaus.ok && new URL(e.request.url).origin === location.origin) {
        const c = await caches.open(VARASTO);
        c.put(e.request, vastaus.clone());
      }
      return vastaus;
    } catch (err) {
      return caches.match('./index.html');
    }
  })());
});
