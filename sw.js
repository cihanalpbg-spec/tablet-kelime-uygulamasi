const CACHE_NAME = 'kelime-merkezi-v6';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icon.png',
  './icon-192.png',
  './icon-512.png',
  './gelistirici.png'
];

// Install event - cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Service Worker: Caching core assets');
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - handle network-first / cache fallback or cache-first for local static assets
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // If it's an external API call, fetch from network directly
  if (url.hostname.includes('dictionaryapi.dev') || url.hostname.includes('googleapis.com')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        // If offline and we have it in cache (e.g. for libraries), try returning cache
        return caches.match(event.request);
      })
    );
    return;
  }

  // Handle CDN libraries, Google Fonts, and font files by caching them dynamically when loaded
  if (url.hostname.includes('jsdelivr.net') || url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache and update in background
          fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, networkResponse));
            }
          }).catch(() => {});
          return cachedResponse;
        }
        return fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseToCache));
          }
          return networkResponse;
        }).catch(() => {
          // If network fails and not in cache
          return null;
        });
      })
    );
    return;
  }

  // For local assets, use a Stale-While-Revalidate strategy
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        // Fetch in the background to update the cache
        fetch(event.request).then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => { /* Ignore offline network update failures */ });
        
        return cachedResponse;
      }

      // If not in cache, fetch from network and cache it
      return fetch(event.request).then(networkResponse => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(err => {
        console.log('Service Worker fetch failed for local asset:', err);
      });
    })
  );
});
