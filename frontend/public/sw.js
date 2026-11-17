/* =============================================================================
   FaceDetect AI Enterprise Attendance System - Production PWA Service Worker
   Version: 1.0.0
   ============================================================================= */

const CACHE_VERSION = 'facedetect-v1.0.0';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const ASSETS_CACHE = `${CACHE_VERSION}-assets`;

// Pre-cached core application shell assets
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
];

/**
 * Determine whether a request must strictly bypass the cache.
 * Excludes all API calls, authentication, attendance, biometrics, camera feeds,
 * dynamic images, cross-origin requests, and non-GET HTTP methods.
 */
function isExcludedFromCache(url, request) {
  // 1. Strictly bypass non-GET requests (POST, PUT, PATCH, DELETE, etc.)
  if (request.method !== 'GET') {
    return true;
  }

  // 2. Strictly bypass cross-origin requests (e.g. backend :3000, AI service :8000)
  if (url.origin !== self.location.origin) {
    return true;
  }

  const pathname = url.pathname.toLowerCase();

  // 3. Exclude all API routes
  if (pathname.startsWith('/api') || pathname.includes('/api/')) {
    return true;
  }

  // 4. Exclude sensitive modules, dynamic employee/unknown face imagery, and live streams
  const sensitivePatterns = [
    '/auth',
    '/login',
    '/register',
    '/attendance',
    '/face-enrollments',
    '/employees',
    '/cameras',
    '/vehicles',
    '/reports',
    'unknown-images',
    'employee-images',
    'stream',
    'snapshot',
  ];

  for (const pattern of sensitivePatterns) {
    if (pathname.includes(pattern)) {
      // Allow fingerprinted static build chunks in /assets/ (e.g. employee_banner_art_perfect-*.png)
      if (pathname.startsWith('/assets/')) {
        continue;
      }
      return true;
    }
  }

  return false;
}

/**
 * Validate response integrity prior to caching.
 */
function isValidCacheableResponse(response) {
  return Boolean(
    response &&
    response.status === 200 &&
    (response.type === 'basic' || response.type === 'default')
  );
}

// ── 1. INSTALL LIFECYCLE ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        return Promise.allSettled(
          PRECACHE_ASSETS.map((url) =>
            fetch(url)
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`Failed to precache ${url}: ${response.status}`);
                }
                return cache.put(url, response);
              })
              .catch((err) => {
                console.warn(`[ServiceWorker] Precache warning for ${url}:`, err.message);
              })
          )
        );
      })
      .then(() => {
        // Prepare worker for activation on next lifecycle without forcibly disrupting current tabs
        return self.skipWaiting();
      })
  );
});

// ── 2. ACTIVATE LIFECYCLE & CACHE CLEANUP ──
self.addEventListener('activate', (event) => {
  const activeCaches = [STATIC_CACHE, ASSETS_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!activeCaches.includes(cacheName)) {
              console.log('[ServiceWorker] Cleaning outdated cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[ServiceWorker] Active & claiming clients for version:', CACHE_VERSION);
        return self.clients.claim();
      })
  );
});

// ── 3. FETCH INTERCEPTION & STRATEGIES ──
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Rule 1: Strict bypass for non-GET, API, biometrics, camera feeds, and sensitive data
  if (isExcludedFromCache(url, request)) {
    return; // Pass through directly to network
  }

  // Strategy A: Navigation requests (SPA client routing)
  // Network-First with fallback to cached application shell (/index.html)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (isValidCacheableResponse(networkResponse)) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put('/index.html', copy).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          if (cachedIndex) {
            return cachedIndex;
          }
          return caches.match('/');
        })
    );
    return;
  }

  // Strategy B: Fingerprinted Vite static assets (/assets/*)
  // Cache-First with network fallback & dynamic caching of valid assets
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(request).then((networkResponse) => {
          if (isValidCacheableResponse(networkResponse)) {
            const copy = networkResponse.clone();
            caches.open(ASSETS_CACHE).then((cache) => {
              cache.put(request, copy).catch(() => {});
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // Strategy C: Precached core static files (favicon, manifest, icons)
  // Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (isValidCacheableResponse(networkResponse)) {
            const copy = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, copy).catch(() => {});
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// ── 4. MESSAGE EVENT FOR UPDATES & INSTALLED MOBILE ALARMS ──
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  // Trigger mobile vibration and native alert for installed PWA
  if (event.data && event.data.type === 'TRIGGER_MOBILE_ALARM') {
    const { title, body, vibrate, url, faceId } = event.data;
    const vibrationPattern = vibrate || [500, 200, 500, 200, 800, 300, 1000];

    event.waitUntil(
      self.registration.showNotification(title || '🚨 Security Alarm: Unrecognized Face Detected', {
        body: body || 'Surveillance system captured an unrecognized visitor.',
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        vibrate: vibrationPattern,
        tag: `unrec-face-${faceId || Date.now()}`,
        renotify: true,
        requireInteraction: true,
        data: {
          url: url || '/unknown-faces',
          timestamp: Date.now(),
        },
        actions: [
          { action: 'review', title: '👀 View Face' },
          { action: 'dismiss', title: '✕ Dismiss' },
        ],
      })
    );
  }
});

// ── 5. NOTIFICATION CLICK HANDLING FOR INSTALLED PWA ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const targetUrl = event.notification.data?.url || '/unknown-faces';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Focus existing open tab if available
        for (const client of clientList) {
          if ('focus' in client) {
            client.navigate(targetUrl);
            return client.focus();
          }
        }
        // Otherwise open a new window/app view
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});

// ── 6. PUSH EVENT (REMOTE PUSH NOTIFICATIONS) ──
self.addEventListener('push', (event) => {
  let payload = {
    title: '🚨 Security Alarm: Unrecognized Face Detected',
    body: 'An unregistered person was captured by security cameras.',
    url: '/unknown-faces',
    vibrate: [500, 200, 500, 200, 800, 300, 1000],
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (e) {
      payload.body = event.data.text() || payload.body;
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      vibrate: payload.vibrate,
      tag: 'unrecognized-face-alarm',
      renotify: true,
      requireInteraction: true,
      data: {
        url: payload.url,
      },
    })
  );
});

