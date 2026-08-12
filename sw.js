/* Service worker: deixa o app funcionar offline.
   Estratégia: rede primeiro (para pegar versões novas), cache como reserva. */
const CACHE = 'prumo-v3';
const ARQUIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then(chaves => Promise.all(chaves.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (ev) => {
  const url = new URL(ev.request.url);
  if (ev.request.method !== 'GET' || url.origin !== location.origin) return;
  ev.respondWith(
    fetch(ev.request)
      .then(resp => {
        const copia = resp.clone();
        caches.open(CACHE).then(c => c.put(ev.request, copia));
        return resp;
      })
      .catch(() => caches.match(ev.request, { ignoreSearch: true })
        .then(r => r || caches.match('index.html')))
  );
});
