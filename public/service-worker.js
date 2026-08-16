const CACHE = 'photuna-booth-v1';

self.addEventListener('install', ev => {
  ev.waitUntil(
    caches.open(CACHE).then(c => c.addAll(['/index.html', '/manifest.json']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const url = new URL(ev.request.url);

  // Skip non-GET and non-http(s)
  if (ev.request.method !== 'GET' || !url.protocol.startsWith('http')) return;

  // Supabase API / edge functions — network only, never cache
  if (url.hostname.includes('supabase.co')) return;

  // SPA navigation — network first, fall back to cached shell
  if (ev.request.mode === 'navigate') {
    ev.respondWith(
      fetch(ev.request)
        .then(res => { putCache(ev.request, res.clone()); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — cache first, populate on first fetch
  ev.respondWith(
    caches.match(ev.request).then(cached => {
      if (cached) return cached;
      return fetch(ev.request).then(res => {
        if (res && res.ok) putCache(ev.request, res.clone());
        return res;
      });
    })
  );
});

function putCache(req, res) {
  caches.open(CACHE).then(c => c.put(req, res));
}
