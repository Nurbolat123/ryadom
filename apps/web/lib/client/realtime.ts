"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

const HEARTBEAT_MS = 30_000;

/**
 * Одно подключение к realtime-сервису на вкладку, общее для всех компонентов.
 * Сервер шлёт только сигналы без данных о людях:
 * - people:changed — список в заведении изменился;
 * - presence:ended — отметка закончилась;
 * - match {chatId} — взаимная симпатия;
 * - inbox:changed — новый привет или анонимное уведомление;
 * - chat:changed {chatId} — новое сообщение или обмен контактами.
 * Сами данные приходят через веб-API, где проверяются права.
 */
export type RealtimeHandlers = {
  onPeopleChanged: () => void;
  onEnded: () => void;
  onMatch: (chatId: string) => void;
  onInbox: () => void;
  onChat: (chatId: string) => void;
};

/**
 * Куда подключаться. Если NEXT_PUBLIC_REALTIME_URL пуст или открыт не localhost
 * (например, GitHub Codespaces, где наружу виден только порт сайта), — через адрес сайта:
 * Next проксирует /socket.io в realtime-сервис.
 */
const realtimeTarget = (): { url?: string; transports: ("polling" | "websocket")[] } => {
  const env = process.env.NEXT_PUBLIC_REALTIME_URL;
  const local = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (env && (local || !env.includes("localhost")))
    return { url: env, transports: ["websocket", "polling"] };
  return { transports: ["polling"] };
};

const visible = () => document.visibilityState === "visible";

/**
 * Одноразовый билет на каждое (пере)подключение: cookie сессии на другой домен не уходит.
 * visible — приложение на экране: тогда push не нужен, сигнал придёт сюда.
 */
const withTicket = (cb: (data: object) => void) => {
  fetch("/api/realtime/ticket", { method: "POST" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((b: { ticket?: string }) => cb({ ticket: b.ticket, visible: visible() }))
    .catch(() => cb({ visible: visible() }));
};
const onVisibility = () => socket?.emit("visibility", visible());

const listeners = new Set<{ current: Partial<RealtimeHandlers> }>();
const each = (fn: (h: Partial<RealtimeHandlers>) => void) =>
  listeners.forEach((l) => fn(l.current));

let socket: Socket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const connect = () => {
  const { url, transports } = realtimeTarget();
  const opts = { auth: withTicket, withCredentials: true, transports };
  const s = url ? io(url, opts) : io(opts);
  s.on("people:changed", () => each((h) => h.onPeopleChanged?.()));
  s.on("presence:ended", () => each((h) => h.onEnded?.()));
  s.on("match", (e: { chatId: string }) => each((h) => h.onMatch?.(e.chatId)));
  s.on("inbox:changed", () => each((h) => h.onInbox?.()));
  s.on("chat:changed", (e: { chatId: string }) => each((h) => h.onChat?.(e.chatId)));
  // После переподключения могли пропустить сигналы — обновляем всё.
  s.io.on("reconnect", () =>
    each((h) => {
      h.onPeopleChanged?.();
      h.onInbox?.();
    }),
  );
  timer = setInterval(() => {
    if (!s.connected) return;
    s.timeout(10_000)
      .emitWithAck("heartbeat")
      .then((r: { present: boolean }) => {
        if (!r.present) each((h) => h.onEnded?.());
      })
      .catch(() => undefined);
  }, HEARTBEAT_MS);
  return s;
};

/** Подписаться на сигналы realtime, пока компонент на экране. */
export function useRealtime(handlers: Partial<RealtimeHandlers>, active = true) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!active) return;
    listeners.add(ref);
    if (!socket) {
      socket = connect();
      document.addEventListener("visibilitychange", onVisibility);
    }
    return () => {
      listeners.delete(ref);
      if (listeners.size === 0 && socket) {
        document.removeEventListener("visibilitychange", onVisibility);
        if (timer) clearInterval(timer);
        socket.disconnect();
        socket = null;
      }
    };
  }, [active]);
}
