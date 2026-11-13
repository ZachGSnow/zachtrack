// Daily reminders (ARCHITECTURE.md 3.73), loaded into the service worker that
// vite-plugin-pwa generates (workbox `importScripts` in vite.config.ts).
// A push wakes the service worker even when the app is closed; it shows the
// message, and a tap opens the app (or brings it forward) at the page given.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'ZachTrack';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/pwa-192.png',
      // One reminder at a time: a new one replaces yesterday's.
      tag: 'zachtrack-reminder',
      data: { url: data.url || '/#/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/#/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
