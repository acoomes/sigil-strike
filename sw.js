const CACHE_NAME = 'sigil-strike-v2';
const BASE_PATH = new URL('./', self.location.href).pathname;
const CORE_ASSETS = [
  BASE_PATH,
  `${BASE_PATH}index.html`,
  `${BASE_PATH}game/`,
  `${BASE_PATH}game/index.html`,
  `${BASE_PATH}game/styles.css`,
  `${BASE_PATH}game/game.js`,
  `${BASE_PATH}manifest.webmanifest`,
  `${BASE_PATH}pwa-icon.svg`,
  `${BASE_PATH}offline.html`,
  `${BASE_PATH}landing/assets/library_logo.png`,
  `${BASE_PATH}landing/assets/screenshot_1.png`,
  `${BASE_PATH}landing/assets/screenshot_2.png`,
  `${BASE_PATH}landing/assets/screenshot_3.png`
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true });
        if (cached) return cached;

        if (request.mode === 'navigate') {
          return caches.match(`${BASE_PATH}offline.html`);
        }

        return Response.error();
      })
  );
});
