"use client";

/**
 * PWA на клиенте: service worker, установка на главный экран, Web Push.
 * Состояние подписки хранит браузер (PushManager) и сервер; здесь только склейка.
 */

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

let installEvent: InstallEvent | null = null;
const installListeners = new Set<() => void>();

/** Регистрация service worker и перехват системного предложения установки (Chrome, Android). */
export const setupPwa = () => {
  if (!("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvent = e as InstallEvent;
    installListeners.forEach((l) => l());
  });
  window.addEventListener("appinstalled", () => {
    installEvent = null;
    installListeners.forEach((l) => l());
  });
};

export const onInstallChange = (fn: () => void) => {
  installListeners.add(fn);
  return () => void installListeners.delete(fn);
};
export const canPromptInstall = () => !!installEvent;
export const promptInstall = async () => {
  const e = installEvent;
  if (!e) return false;
  installEvent = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  installListeners.forEach((l) => l());
  return outcome === "accepted";
};

/** Уже открыто как приложение с главного экрана. */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** iPhone/iPad в Safari: установка только вручную, через «Поделиться». */
export const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|YaBrowser/.test(ua);
};

export type PushState = "unavailable" | "needs-install" | "denied" | "off" | "on";

const registration = () => navigator.serviceWorker.ready;

const base64ToBytes = (b64: string) => {
  const s = atob(
    (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"),
  );
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

const publicKey = async () => {
  const r = await fetch("/api/push/key");
  if (!r.ok) return null;
  return ((await r.json()) as { publicKey: string | null }).publicKey;
};

/** Адрес подписки этого браузера (для выхода из аккаунта). */
export const currentEndpoint = async () => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription())?.endpoint ?? null;
};

export const getPushState = async (): Promise<PushState> => {
  if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window))
    // На iPhone в Safari push появляется только после «На экран „Домой“».
    return isIosSafari() && !isStandalone() ? "needs-install" : "unavailable";
  if (!(await publicKey())) return "unavailable";
  if (Notification.permission === "denied") return "denied";
  const endpoint = await currentEndpoint();
  if (!endpoint || Notification.permission !== "granted") return "off";
  // Подписка браузера могла остаться от другого аккаунта.
  const r = await fetch("/api/push/status", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  return r.ok && ((await r.json()) as { subscribed: boolean }).subscribed ? "on" : "off";
};

/** Включить уведомления: разрешение браузера → подписка → сервер. */
export const enablePush = async (): Promise<PushState> => {
  const key = await publicKey();
  if (!key) return "unavailable";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // Без связи с push-сервисом браузер может не ответить вовсе — не ждём бесконечно.
    sub = await Promise.race([
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(key),
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
  }
  const r = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  return r.ok ? "on" : "off";
};

export const disablePush = async (): Promise<PushState> => {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await fetch("/api/push/subscribe", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe().catch(() => undefined);
  }
  return "off";
};
