// PersonaX service worker: makes the installed app launch fast and show its
// shell when offline. Gemini API traffic is never intercepted.
const CACHE = 'personax-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png', './favicon.svg'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const putInCache = async (request, response) => {
  if (response && (response.ok || response.type === 'opaque')) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
};

// Always try the network for the page itself so new deploys show up
// immediately; fall back to the cached shell when offline.
const networkFirst = async (request) => {
  try {
    const response = await fetch(request);
    await putInCache('./', response.clone());
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match('./')) || Response.error();
  }
};

// Built assets have content hashes in their names, so a cached copy never goes stale.
const cacheFirst = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  return putInCache(request, await fetch(request));
};

const staleWhileRevalidate = async (request, event) => {
  const cached = await caches.match(request);
  const refresh = fetch(request).then((response) => putInCache(request, response)).catch(() => cached);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return refresh;
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
  } else if (url.origin === self.location.origin) {
    event.respondWith(url.pathname.includes('/assets/') ? cacheFirst(request) : staleWhileRevalidate(request, event));
  } else if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
