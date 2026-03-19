// CareWatch Service Worker
const CACHE_NAME = 'carewatch-v1';
const SHELL_ASSETS = ['/', '/index.html'];

// ── Install: cache app shell ──────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache with network fallback ─────────────────
self.addEventListener('fetch', (event) => {
  // Skip non-GET, API calls, and WebSocket upgrades
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/ws')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (
          event.request.url.includes('/assets/') ||
          event.request.url.endsWith('.js') ||
          event.request.url.endsWith('.css')
        )) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── Push: show notification ───────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { title: 'CareWatch Alert', body: event.data?.text() }; }

  const options = {
    body: data.body || 'You have a new alert',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.alertId || 'carewatch-alert',
    data: { url: data.url || '/?tab=alerts' },
    requireInteraction: data.urgency === 'high',
    vibrate: data.urgency === 'high' ? [200, 100, 200, 100, 200] : [200],
    actions: [
      { action: 'view',    title: 'View Dashboard' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'CareWatch Alert', options)
  );
});

// ── Notification click ────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      // Focus existing window if open
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
