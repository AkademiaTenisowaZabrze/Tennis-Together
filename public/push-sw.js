// Service Worker wyłącznie do powiadomień push w wersji przeglądarkowej.
// Rejestrowany osobno (scope /push/), żeby nie kolidował z głównym
// Service Workerem PWA. Wiadomość z Firebase Cloud Messaging ma postać
// { notification: { title, body } }; pokazujemy ją zawsze, także gdy karta
// aplikacji jest otwarta.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const n = payload.notification || payload.data || {};
  const title = n.title || "Tennis Together";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: n.body || "",
      icon: new URL("icon-192.png", self.location).href,
      badge: new URL("icon-192.png", self.location).href,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL("./", self.location).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url.startsWith(target) && "focus" in c) return c.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
