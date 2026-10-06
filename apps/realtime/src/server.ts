import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { PrismaClient } from "@ryadom/db";
import {
  getPresence,
  parsePresenceEvent,
  PRESENCE_CHANNEL,
  sweepExpired,
  type PresenceEvent,
} from "@ryadom/presence";
import { realtimeTicketKey } from "@ryadom/shared";
import type { Redis } from "ioredis";
import { Server, type Socket } from "socket.io";

/**
 * Realtime-сервис «Рядом».
 * - Вход по одноразовому билету из веб-API (/api/realtime/ticket) или по cookie сессии,
 *   если realtime на том же домене, что и сайт.
 * - Комната venue:<id> — только для тех, у кого сейчас присутствие в этом заведении (правило 1).
 * - В комнату уходят только сигналы «список изменился» без данных о людях:
 *   сам список каждый получает через веб-API со своими правами (общие интересы, блокировки).
 * - Логи без телефонов, координат и текстов сообщений.
 */

const SESSION_COOKIE = "ryadom_session";
export const venueRoom = (venueId: string) => `venue:${venueId}`;
export const userRoom = (userId: string) => `user:${userId}`;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

const readCookie = (header: string | undefined, name: string) => {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
};

export type RealtimeOptions = {
  db: PrismaClient;
  /** Клиент для команд. */
  redis: Redis;
  /** Отдельный клиент для подписки (в режиме subscribe он не выполняет команды). */
  sub: Redis;
  corsOrigin: string | string[];
  sweepIntervalMs?: number;
};

export const createRealtime = ({
  db,
  redis,
  sub,
  corsOrigin,
  sweepIntervalMs = 30_000,
}: RealtimeOptions) => {
  const http = createServer(async (req, res) => {
    if (req.url === "/health") {
      const ok = await redis.ping().then(
        () => true,
        () => false,
      );
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, redis: ok }));
      return;
    }
    res.writeHead(404).end();
  });

  const io = new Server(http, { cors: { origin: corsOrigin, credentials: true } });

  /** Вход: только зарегистрированный пользователь с действующей сессией. */
  const userFromCookie = async (header: string | undefined) => {
    const token = readCookie(header, SESSION_COOKIE);
    if (!token) return null;
    const session = await db.session.findUnique({
      where: { tokenHash: sha256(token) },
      select: { userId: true, expiresAt: true },
    });
    return session?.userId && session.expiresAt >= new Date() ? session.userId : null;
  };
  const userFromTicket = async (ticket: unknown) =>
    typeof ticket === "string" && ticket.length <= 128
      ? redis.getdel(realtimeTicketKey(sha256(ticket)))
      : null;

  io.use(async (socket, next) => {
    const userId =
      (await userFromTicket((socket.handshake.auth as { ticket?: unknown })?.ticket)) ??
      (await userFromCookie(socket.handshake.headers.cookie));
    if (!userId) return next(new Error("unauthorized"));
    socket.data.userId = userId;
    next();
  });

  /** Привести комнаты сокетов пользователя в соответствие с его присутствием. */
  const syncRooms = async (userId: string) => {
    const presence = await getPresence(redis, userId);
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    for (const s of sockets) {
      for (const room of s.rooms) {
        if (room.startsWith("venue:") && room !== (presence && venueRoom(presence.venueId)))
          s.leave(room);
      }
      if (presence) s.join(venueRoom(presence.venueId));
    }
    return presence;
  };

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.join(userRoom(userId));
    const presence = await syncRooms(userId);
    socket.emit("presence", { present: !!presence });

    // Heartbeat клиента: подтверждаем, что отметка ещё действует.
    socket.on("heartbeat", async (ack?: (r: { present: boolean }) => void) => {
      const p = await syncRooms(userId);
      if (typeof ack === "function") ack({ present: !!p });
    });
  });

  const onEvent = async (e: PresenceEvent) => {
    if (e.type === "joined" || e.type === "left") await syncRooms(e.userId);
    if (e.type === "left") io.to(userRoom(e.userId)).emit("presence:ended");
    // Сигнал без данных: кто именно пришёл или ушёл, в событии не передаётся.
    io.to(venueRoom(e.venueId)).emit("people:changed");
  };

  sub
    .subscribe(PRESENCE_CHANNEL)
    .catch((err: Error) => console.error("realtime: подписка не удалась", err.message));
  sub.on("message", (channel, raw) => {
    if (channel !== PRESENCE_CHANNEL) return;
    const e = parsePresenceEvent(raw);
    if (e) void onEvent(e);
  });

  // Истечение TTL (2 часа): убираем из комнат и обновляем списки.
  const sweep = async () => {
    for (const { venueId, userIds } of await sweepExpired(redis)) {
      for (const userId of userIds) {
        await syncRooms(userId);
        io.to(userRoom(userId)).emit("presence:ended");
      }
      io.to(venueRoom(venueId)).emit("people:changed");
    }
  };
  const timer = setInterval(() => void sweep().catch(() => undefined), sweepIntervalMs);

  return {
    http,
    io,
    sweep,
    close: async () => {
      clearInterval(timer);
      await sub.unsubscribe(PRESENCE_CHANNEL).catch(() => undefined);
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
};
