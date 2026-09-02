/**
 * Secure Chat Server - Service Worker
 * -----------------------------------
 * Scope: intentionally minimal and conservative. This exists ONLY to
 * satisfy PWA installability criteria and provide a basic offline
 * fallback shell - it must never change or interfere with live app
 * behaviour (auth, sockets, uploads, API calls).
 *
 * Strategy:
 *  - API calls (/api/*), Socket.IO (/socket.io/*) and uploaded files
 *    (/uploads/*) are NEVER intercepted - always go straight to the
 *    network, exactly as if no service worker existed.
 *  - Static shell assets (HTML/CSS/JS/icons) use network-first with a
 *    cache fallback, so the app still opens (read-only shell) when
 *    offline, but always prefers fresh content when online.
 */

const CACHE_VERSION = 'scs-shell-v2';
const APP_SHELL = [
  '/',
  '/chat',
  '/css/style.css',
  '/js/api.js',
  '/js/ui-helpers.js',
  '/js/chat.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isBypassed(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/uploads/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle simple GET navigations/assets - never touch POST/PUT/etc.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin (fonts CDN, etc.) and any live/data endpoints: pass through untouched.
  if (url.origin !== self.location.origin || isBypassed(url)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Keep the shell cache fresh, but don't let a failed clone break the response.
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match('/'))
      )
  );
});
