"use client";

import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

const HEARTBEAT_MS = 30_000;

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

/** Одноразовый билет на каждое (пере)подключение: cookie сессии на другой домен не уходит. */
const withTicket = (cb: (data: object) => void) => {
  fetch("/api/realtime/ticket", { method: "POST" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((b: { ticket?: string }) => cb({ ticket: b.ticket }))
    .catch(() => cb({}));
};

/**
 * Подключение к realtime-сервису, пока ты отмечен(а) в заведении.
 * Сервер шлёт только сигналы без данных: «список изменился» и «отметка закончилась».
 * Сам список приходит через веб-API, где проверяются права.
 */
export function usePresenceSocket(
  active: boolean,
  handlers: { onPeopleChanged: () => void; onEnded: () => void },
) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    if (!active) return;
    const { url, transports } = realtimeTarget();
    const opts = { auth: withTicket, withCredentials: true, transports };
    const socket: Socket = url ? io(url, opts) : io(opts);
    socket.on("people:changed", () => ref.current.onPeopleChanged());
    socket.on("presence:ended", () => ref.current.onEnded());
    // После переподключения могли пропустить сигналы — обновляем список.
    socket.io.on("reconnect", () => ref.current.onPeopleChanged());

    const beat = () => {
      if (!socket.connected) return;
      socket
        .timeout(10_000)
        .emitWithAck("heartbeat")
        .then((r: { present: boolean }) => {
          if (!r.present) ref.current.onEnded();
        })
        .catch(() => undefined);
    };
    const timer = setInterval(beat, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      socket.disconnect();
    };
  }, [active]);
}
