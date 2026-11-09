const CACHE_NAME = 'lastplate-cache-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/hackathon.css',
  '/recommendation.css',
  '/seller-dashboard.css',
  '/app.js',
  '/manifest.json',
  '/favicon.png',
  '/favicon-32.png',
  '/images/logo.png',
  '/images/logo-horizontal.png',
  '/images/logo-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Pre-cache warning (some assets optional):', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // For API calls, try network first, fallback to offline response if applicable
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(JSON.stringify({ error: 'You are currently offline. Local passes remain accessible.' }), {
          headers: { 'content-type': 'application/json' },
          status: 503
        });
      })
    );
    return;
  }

  // Stale-while-revalidate for static shell assets
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

