/**
 * OptiRx — Service Worker
 * © Manik Roy 2026. All Rights Reserved.
 *
 * Strategy:
 *  - Shell (HTML/CSS/JS): Cache-First, update in background
 *  - Google Fonts: StaleWhileRevalidate
 *  - External APIs (QR): NetworkFirst with fallback
 *  - All other requests: NetworkFirst with cache fallback
 */

const APP_NAME    = 'OptiRx';
const CACHE_VER   = 'v2.0.0';
const STATIC_CACHE  = `${APP_NAME}-static-${CACHE_VER}`;
const DYNAMIC_CACHE = `${APP_NAME}-dynamic-${CACHE_VER}`;
const FONT_CACHE    = `${APP_NAME}-fonts-${CACHE_VER}`;

// All caches managed by this SW
const ALL_CACHES = [STATIC_CACHE, DYNAMIC_CACHE, FONT_CACHE];

// ─── ASSETS TO PRE-CACHE ON INSTALL ───────────────────────────────────────
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-32.png',
];

const FONT_URLS = [
  'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Mono:wght@300;400;500&family=Instrument+Sans:wght@400;500;600&display=swap',
];

// ─── INSTALL ───────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[${APP_NAME} SW] Installing ${CACHE_VER}`);

  event.waitUntil(
    (async () => {
      // Pre-cache static shell
      const staticCache = await caches.open(STATIC_CACHE);
      try {
        await staticCache.addAll(STATIC_ASSETS);
        console.log(`[${APP_NAME} SW] Static assets cached`);
      } catch (err) {
        console.warn(`[${APP_NAME} SW] Some static assets failed to cache:`, err);
        // Cache what we can individually
        for (const url of STATIC_ASSETS) {
          try { await staticCache.add(url); } catch (e) { /* skip missing */ }
        }
      }

      // Pre-cache fonts
      const fontCache = await caches.open(FONT_CACHE);
      for (const url of FONT_URLS) {
        try { await fontCache.add(url); } catch (e) { /* fonts may fail offline */ }
      }

      // Take control immediately
      await self.skipWaiting();
    })()
  );
});

// ─── ACTIVATE ─────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[${APP_NAME} SW] Activating ${CACHE_VER}`);

  event.waitUntil(
    (async () => {
      // Delete old caches from previous versions
      const cacheNames = await caches.keys();
      const deletions = cacheNames
        .filter(name => name.startsWith(APP_NAME) && !ALL_CACHES.includes(name))
        .map(name => {
          console.log(`[${APP_NAME} SW] Deleting old cache: ${name}`);
          return caches.delete(name);
        });
      await Promise.all(deletions);

      // Claim all clients immediately
      await clients.claim();
      console.log(`[${APP_NAME} SW] Active and claiming clients`);
    })()
  );
});

// ─── FETCH STRATEGY ───────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin non-font/API requests
  if (request.method !== 'GET') return;

  // ── Google Fonts → StaleWhileRevalidate ──
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(request, FONT_CACHE));
    return;
  }

  // ── QR Code API → NetworkFirst (image needs network) ──
  if (url.hostname === 'api.qrserver.com') {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
    return;
  }

  // ── App Shell (same origin HTML/manifest) → CacheFirst + background update ──
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithUpdate(request, STATIC_CACHE));
    return;
  }

  // ── Everything else → NetworkFirst with cache fallback ──
  event.respondWith(networkFirst(request, DYNAMIC_CACHE));
});

// ─── STRATEGY HELPERS ─────────────────────────────────────────────────────

/**
 * CacheFirst — serve from cache, fetch & update in background
 */
async function cacheFirstWithUpdate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || offlineFallback(request);
}

/**
 * NetworkFirst — try network, fall back to cache, then offline page
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    return cached || offlineFallback(request);
  }
}

/**
 * StaleWhileRevalidate — serve cached immediately, update in background
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then(response => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || fetchPromise;
}

/**
 * Offline fallback — return offline.html for navigation requests
 */
async function offlineFallback(request) {
  if (request.headers.get('Accept')?.includes('text/html')) {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match('./offline.html');
    return offline || new Response('<h1>OptiRx — Offline</h1><p>Please check your connection.</p>', {
      headers: { 'Content-Type': 'text/html' }
    });
  }
  return new Response('', { status: 408, statusText: 'Request Timeout' });
}

// ─── BACKGROUND SYNC ──────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  console.log(`[${APP_NAME} SW] Background sync: ${event.tag}`);
  if (event.tag === 'sync-prescriptions') {
    event.waitUntil(syncPrescriptions());
  }
});

async function syncPrescriptions() {
  // Placeholder for future cloud sync implementation
  console.log(`[${APP_NAME} SW] Syncing prescriptions in background...`);
}

// ─── PUSH NOTIFICATIONS ───────────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'OptiRx', body: 'You have a notification from OptiRx.', icon: './icons/icon-192.png' };
  try { data = { ...data, ...event.data.json() }; } catch (e) {}

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon || './icons/icon-192.png',
      badge: './icons/icon-72.png',
      vibrate: [200, 100, 200],
      tag: 'optirx-notification',
      renotify: true,
      actions: [
        { action: 'open', title: 'Open OptiRx' },
        { action: 'dismiss', title: 'Dismiss' }
      ],
      data: { url: './index.html', timestamp: Date.now() }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./index.html');
    })
  );
});

// ─── MESSAGE HANDLING ─────────────────────────────────────────────────────
self.addEventListener('message', event => {
  const { type } = event.data || {};

  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (type === 'GET_VERSION') {
    event.source?.postMessage({ type: 'VERSION', version: CACHE_VER });
    return;
  }

  if (type === 'CLEAR_CACHE') {
    event.waitUntil(
      Promise.all(ALL_CACHES.map(name => caches.delete(name)))
        .then(() => event.source?.postMessage({ type: 'CACHE_CLEARED' }))
    );
    return;
  }
});

console.log(`[${APP_NAME} SW] ${CACHE_VER} loaded`);
