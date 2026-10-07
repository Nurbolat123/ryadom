/* global self, caches, fetch, URL, Request, Response */
/* Service worker «рядом» (этап 10): установка PWA, Web Push, страница «нет сети».
 * Ничего, кроме страницы «нет сети», не кешируется: списки людей, приветы и чаты
 * не должны оставаться на устройстве и показываться устаревшими. */
const CACHE = "ryadom-offline-v2";
const OFFLINE_URL = "/offline";

/** Страница «Нет сети» и её стили/скрипты/логотип — чтобы без сети она выглядела как приложение. */
const cacheOfflinePage = async () => {
  const cache = await caches.open(CACHE);
  const res = await fetch(new Request(OFFLINE_URL, { cache: "reload" }));
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put(OFFLINE_URL, res);
  const assets = new Set(["/brand/logo-mark.svg"]);
  for (const m of html.matchAll(/(?:href|src)="(\/_next\/static\/[^"]+)"/g)) assets.add(m[1]);
  await Promise.all([...assets].map((u) => cache.add(u).catch(() => undefined)));
};

self.addEventListener("install", (event) => {
  event.waitUntil(cacheOfflinePage().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Переходы между страницами: сеть, а без сети — страница «нет сети».
// Файлы этой страницы без сети берутся из кеша. API идёт как обычно и никогда не кешируется.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
    return;
  }
  const url = new URL(req.url);
  if (
    req.method === "GET" &&
    url.origin === self.location.origin &&
    (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/"))
  ) {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req, { cacheName: CACHE }).then((r) => r || Response.error()),
      ),
    );
  }
});

// В уведомлении только общий текст: ни имён, ни текстов сообщений (их нет и на сервере push).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "рядом";
  const url = typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/inbox";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      tag: typeof data.tag === "string" ? data.tag : "ryadom",
      renotify: true,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => new URL(c.url).origin === self.location.origin);
      if (open) return open.focus().then((c) => c.navigate(url));
      return self.clients.openWindow(url);
    }),
  );
});

// Браузер сменил подписку (истекла или сброшена) — переподписываемся тем же ключом.
self.addEventListener("pushsubscriptionchange", (event) => {
  const key = event.oldSubscription && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then((sub) =>
        fetch("/api/push/subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        }),
      ),
  );
});
