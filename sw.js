/**
 * Offline shell for The Barn.
 *
 * Strategy: race the network against a short timeout, with the cache as
 * the tiebreaker. A normal connection almost always answers well inside
 * the timeout, so a relaunch gets the freshest deployed code (this app
 * changes often — running stale code silently is worse than a brief wait).
 * A slow or flaky connection falls back to the cached copy instantly
 * instead of stalling the app, and the network response still updates the
 * cache in the background whenever it does arrive. Bump VERSION on any
 * deploy where stale code would matter more than usual — it forces every
 * client to drop its old cache immediately.
 */

const VERSION = 'barn-v4';
const NETWORK_TIMEOUT_MS = 1800;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/core.mjs',
  './src/storage.mjs',
  './src/seed.mjs',
  './src/firestore-sync.mjs',
  './icons/icon.svg',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // addAll fails the whole install if one file 404s; add individually.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request);

    // Always kicked off, whether or not it ends up winning the race below —
    // this is what keeps the cache fresh for next time on a slow network.
    const network = fetch(request).then(response => {
      if (response && response.ok) {
        caches.open(VERSION).then(cache => cache.put(request, response.clone()));
      }
      return response;
    }).catch(() => null);

    if (!cached) {
      // Nothing to fall back to — this fetch has to wait for the network.
      const response = await network;
      if (response) return response;
      if (request.mode === 'navigate') {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
      return Response.error();
    }

    const timeout = new Promise(resolve => setTimeout(() => resolve(null), NETWORK_TIMEOUT_MS));
    const fast = await Promise.race([network, timeout]);
    return fast || cached;
  })());
});
