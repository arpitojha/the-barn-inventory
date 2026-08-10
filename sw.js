/**
 * Offline shell for The Barn.
 *
 * Strategy: network-first for everything same-origin. Online, that means a
 * relaunch always runs the code that's actually deployed — this app changes
 * often, and a bartender silently running last week's build is worse than
 * one extra network round-trip. Offline, every cached response here is the
 * fallback, so the app (and its last-synced data) still opens with no
 * signal. Bump VERSION on any deploy where stale code would matter more
 * than usual — it forces every client to drop its old cache immediately.
 */

const VERSION = 'barn-v3';
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

  // Network-first: always prefer what's actually deployed, cache is only
  // the offline fallback. Navigations fall back to the shell page itself.
  event.respondWith((async () => {
    try {
      const fresh = await fetch(request);
      if (fresh && fresh.ok) {
        const cache = await caches.open(VERSION);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
      return Response.error();
    }
  })());
});
