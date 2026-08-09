/**
 * Offline shell for The Barn.
 *
 * Strategy: precache the app shell on install, then serve navigations and
 * same-origin assets cache-first with a background refresh, so a bartender in
 * a basement cellar with no signal still gets the full app.
 */

const VERSION = 'barn-v2';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/app.js',
  './src/core.mjs',
  './src/storage.mjs',
  './src/seed.mjs',
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

  // Navigations: fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request);
        const cache = await caches.open(VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(response => {
      if (response && response.ok) {
        caches.open(VERSION).then(cache => cache.put(request, response.clone()));
      }
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
