/**
 * Service worker — what makes this installable and usable offline.
 *
 * ★ The network strategy is the whole design, and it is not the usual one.
 *
 * A normal "cache everything first" service worker will happily serve a stale
 * pairing page after an update, or worse, a cached /api/status that says a bot
 * is online when it is not. Showing a wrong live state is worse than showing
 * nothing, so:
 *
 *   /api/*            never cached. The panel's whole job is live truth.
 *   navigation        network first, cache only as an offline fallback.
 *                     A deploy must be visible on the next load.
 *   static assets     cache first (icons, fonts) — these only change when the
 *                     URL changes, and they are what makes the app feel instant.
 *
 * The offline page is a real screen, not the browser's dinosaur, because an
 * installed app that opens to a dinosaur feels broken.
 */

const VERSION = 'zynex-v1';
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

const PRECACHE = [
  '/',
  '/manifest.json',
  '/offline.html',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/apple-touch-icon.png',
  '/assets/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL)
      // addAll rejects the whole install if one URL 404s, so add individually
      .then((c) => Promise.all(PRECACHE.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  );
});

const isApi = (url) => url.pathname.startsWith('/api/');
const isAsset = (url) => /\.(png|jpg|jpeg|svg|ico|woff2?|css|js)$/i.test(url.pathname);

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;   // never touch third parties

  // 1. Live data is never served from a cache.
  if (isApi(url)) {
    event.respondWith(fetch(request));
    return;
  }

  // 2. Pages: network first, so a deploy is visible immediately.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(async () => (await caches.match(request)) || caches.match('/offline.html')),
    );
    return;
  }

  // 3. Static: cache first, refresh in the background.
  if (isAsset(url)) {
    event.respondWith(
      caches.match(request).then((hit) => {
        const net = fetch(request)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSETS).then((c) => c.put(request, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => hit);
        return hit || net;
      }),
    );
  }
});
