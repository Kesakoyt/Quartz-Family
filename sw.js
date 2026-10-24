/**
 * Quartz Family — service worker.
 *
 * Stratégies :
 *  - coque applicative précachée à l'installation ;
 *  - navigation : réseau d'abord, puis index.html en cache ;
 *  - fichiers statiques : cache d'abord, revalidation en arrière-plan ;
 *  - icônes Icons8 : cache d'abord (réponses opaques acceptées) ;
 *  - Firebase, Google Identity et les API Google ne sont jamais interceptés.
 */

const VERSION = '1.0.0';
const CORE_CACHE = `quartz-core-v${VERSION}`;
const ICON_CACHE = `quartz-icons-v${VERSION}`;
const KEEP_CACHES = new Set([CORE_CACHE, ICON_CACHE]);

const INDEX_URL = new URL('./index.html', self.location.href).href;
const OFFLINE_ICON = './icons/icon-192.png';

const PRECACHE_PATHS = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/store.js',
  './js/ui.js',
  './js/firebase.js',
  './js/grid.js',
  './js/install.js',
  './js/drive.js',
  './js/views/login.js',
  './js/views/dashboard.js',
  './js/views/drive.js',
  './js/views/settings.js',
  './vendor/firebase/firebase-app.js',
  './vendor/firebase/firebase-auth.js',
  './vendor/firebase/firebase-firestore.js',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
  './icons/favicon-96.png',
];

const PRECACHE_URLS = PRECACHE_PATHS.map(
  (path) => new URL(path, self.location.href).href
);

/* --------------------------------------------------------------------------
   Installation et activation
   -------------------------------------------------------------------------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CORE_CACHE);
      // Chaque fichier est mis en cache indépendamment : une ressource
      // manquante ne doit pas empêcher l'application de fonctionner hors ligne.
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, { cache: 'reload' });
            if (response && (response.ok || response.type === 'opaque')) {
              await cache.put(url, response);
            }
          } catch (error) {
            console.warn('[Quartz SW] Précache ignoré pour', url, error);
          }
        })
      );
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('quartz-') && !KEEP_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* --------------------------------------------------------------------------
   Interception des requêtes
   -------------------------------------------------------------------------- */

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Icônes Icons8 : cache d'abord, puis réseau.
  if (url.hostname === 'img.icons8.com') {
    event.respondWith(staleWhileRevalidate(event, ICON_CACHE));
    return;
  }

  // Les services Google (Firebase, GIS, Drive) passent directement au réseau.
  if (isThirdParty(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (url.pathname.endsWith('/config.js')) {
    event.respondWith(networkFirst(event, CORE_CACHE));
    return;
  }

  event.respondWith(staleWhileRevalidate(event, CORE_CACHE));
});

function isThirdParty(url) {
  if (url.origin === self.location.origin) return false;
  return true;
}

async function handleNavigation(request) {
  try {
    // La coque est mise en cache par l'installation du service worker :
    // le réseau sert toujours la version la plus récente lorsqu'il est joignable.
    return await fetch(request);
  } catch {
    const cached =
      (await caches.match(INDEX_URL)) ||
      (await caches.match(new URL('./', self.location.href).href));

    if (cached) return cached;

    return new Response(
      `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hors ligne — Quartz Family</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d14;color:#f2f4fa;font-family:system-ui,sans-serif;text-align:center;padding:24px"><div><img src="${OFFLINE_ICON}" width="72" height="72" alt="" style="margin:0 auto 18px"><h1 style="font-size:20px;margin:0 0 8px">Quartz Family est hors ligne</h1><p style="color:#8d96a9;font-size:14px;margin:0">Reconnectez-vous à Internet puis rechargez la page.</p></div></body></html>`,
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

async function networkFirst(event, cacheName) {
  const { request } = event;

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

function staleWhileRevalidate(event, cacheName) {
  const { request } = event;

  const network = fetch(request)
    .then(async (response) => {
      if (response && (response.ok || response.type === 'opaque')) {
        const cache = await caches.open(cacheName);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Enregistré immédiatement : le worker reste actif pendant la revalidation
  // même lorsque la réponse en cache est renvoyée sans attendre le réseau.
  event.waitUntil(network.then(() => undefined));

  return (async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);

    if (cached) return cached;

    const response = await network;
    if (response) return response;

    if (request.mode === 'navigate') {
      const fallback = await caches.match(INDEX_URL);
      if (fallback) return fallback;
    }

    return new Response('', {
      status: 504,
      statusText: 'Hors ligne',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  })();
}
