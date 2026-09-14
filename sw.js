const CACHE_NAME = 'casa-sagrado-v19.1';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './css/base.css',
  './css/components.css',
  './css/modals.css',
  './js/app.js',
  './js/state.js',
  './js/utils.js',
  './js/supabase.js',
  './js/categorias.js',
  './js/estoque.js',
  './js/vendas.js',
  './js/dashboard.js',
  './js/markup.js',
  './js/curva_abc.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://unpkg.com/lucide@latest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const fetchPromises = ASSETS_TO_CACHE.map(async (url) => {
        try {
          // Bypassa cache HTTP do navegador no momento da instalação
          const req = new Request(url, { cache: 'reload' });
          const res = await fetch(req);
          if (res.ok) {
            await cache.put(url, res);
          }
        } catch (e) {
          console.warn('[SW] Falha ao cachear asset:', url, e);
        }
      });
      await Promise.all(fetchPromises);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('supabase.co')) {
    return;
  }

  // Network-First para navegação, HTML, scripts JS e estilos CSS
  const isCodeAsset = event.request.mode === 'navigate' || 
                      event.request.url.endsWith('.html') || 
                      event.request.url.includes('/js/') ||
                      event.request.url.includes('/css/') ||
                      event.request.url.endsWith('/');

  if (isCodeAsset) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => {
            if (cached) return cached;
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        })
    );
    return;
  }

  // Cache-First com fallback para rede para imagens e bibliotecas externas
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      });
    })
  );
});
