import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { PrismaClient } from "@ryadom/db";
import {
  expireStalePurchases,
  getPaymentProvider,
  processRenewals,
  type PaymentProvider,
} from "@ryadom/billing";
import { expireGifts, retryRefunds } from "@ryadom/gifts";
import {
  getPresence,
  parsePresenceEvent,
  parseUserEvent,
  PRESENCE_CHANNEL,
  sweepExpired,
  USER_CHANNEL,
  type PresenceEvent,
  type UserEvent,
} from "@ryadom/presence";
import { sendPush, vapidFromEnv, WebPushSender, type PushSender } from "@ryadom/push";
import { realtimeTicketKey, RULES, type PushKind } from "@ryadom/shared";
import type { Redis } from "ioredis";
import { Server, type Socket } from "socket.io";
import { deleteExpiredSympathies, processNotices } from "./notices";

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
  noticeIntervalMs?: number;
  /** Возвраты за истёкшие подарки. По умолчанию — из PAYMENT_PROVIDER. */
  payments?: PaymentProvider;
  /** Web Push. По умолчанию — VAPID-ключи из .env; без ключей уведомления не отправляются. */
  push?: PushSender | null;
};

const defaultPushSender = () => {
  const vapid = vapidFromEnv();
  return vapid ? new WebPushSender(vapid) : null;
};

export const createRealtime = ({
  db,
  redis,
  sub,
  corsOrigin,
  sweepIntervalMs = 30_000,
  noticeIntervalMs = RULES.noticeTickSeconds * 1000,
  payments = getPaymentProvider(),
  push = defaultPushSender(),
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

  /**
   * Push — только если приложение сейчас не на экране ни на одном устройстве
   * (иначе человек и так видит сигнал в приложении). Видимость сообщает клиент.
   */
  const pushIfAway = async (userId: string, kind: PushKind) => {
    if (!push) return;
    const sockets = await io.in(userRoom(userId)).fetchSockets();
    if (sockets.some((s) => s.data.visible === true)) return;
    await sendPush({ db, redis, sender: push, userId, kind });
  };
  const pushLater = (userId: string, kind: PushKind) =>
    void pushIfAway(userId, kind).catch((err: Error) =>
      console.warn("[push] ошибка отправки:", err.message),
    );

  io.on("connection", async (socket: Socket) => {
    const userId = socket.data.userId as string;
    socket.data.visible = socket.handshake.auth?.visible !== false;
    socket.join(userRoom(userId));
    // Вкладка свернута или снова на экране.
    socket.on("visibility", (visible: unknown) => {
      socket.data.visible = visible === true;
    });
    // Heartbeat клиента: подтверждаем, что отметка ещё действует.
    // Обработчики — до первого await, иначе ранний heartbeat клиента теряется.
    socket.on("heartbeat", async (ack?: (r: { present: boolean }) => void) => {
      const p = await syncRooms(userId);
      if (typeof ack === "function") ack({ present: !!p });
    });
    const presence = await syncRooms(userId);
    socket.emit("presence", { present: !!presence });
  });

  const onEvent = async (e: PresenceEvent) => {
    if (e.type === "joined" || e.type === "left") await syncRooms(e.userId);
    if (e.type === "left") io.to(userRoom(e.userId)).emit("presence:ended");
    // Сигнал без данных: кто именно пришёл или ушёл, в событии не передаётся.
    io.to(venueRoom(e.venueId)).emit("people:changed");
  };

  // Личные события: только тип и id чата, без данных о людях.
  const onUserEvent = (e: UserEvent) => {
    const room = io.to(userRoom(e.userId));
    if (e.type === "match") pushLater(e.userId, "match");
    else if ((e.type === "inbox" || e.type === "chat") && e.push) pushLater(e.userId, e.push);
    if (e.type === "match") room.emit("match", { chatId: e.chatId });
    else if (e.type === "chat") room.emit("chat:changed", { chatId: e.chatId });
    else if (e.type === "refresh") {
      room.emit("people:changed");
      room.emit("inbox:changed");
      room.emit("chat:changed", { chatId: "*" });
    } else if (e.type === "logout") io.in(userRoom(e.userId)).disconnectSockets(true);
    else room.emit("inbox:changed");
  };

  sub
    .subscribe(PRESENCE_CHANNEL, USER_CHANNEL)
    .catch((err: Error) => console.error("realtime: подписка не удалась", err.message));
  sub.on("message", (channel, raw) => {
    if (channel === USER_CHANNEL) {
      const e = parseUserEvent(raw);
      if (e) onUserEvent(e);
      return;
    }
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
    await deleteExpiredSympathies(db);
    // Подарки без ответа 2 часа — expired и возврат денег; обоим обновить входящие.
    for (const g of await expireGifts({ db, payments })) {
      for (const u of [g.fromUserId, g.toUserId]) if (u) io.to(userRoom(u)).emit("inbox:changed");
    }
    await retryRefunds({ db, payments });
    // Неоплаченные заказы старше 30 минут закрываются; продления «Плюс» и напоминания за 2 дня.
    await expireStalePurchases(db);
    await processRenewals({
      db,
      payments,
      notify: (userId) => {
        io.to(userRoom(userId)).emit("inbox:changed");
        pushLater(userId, "plus");
      },
    });
  };
  const timer = setInterval(() => void sweep().catch(() => undefined), sweepIntervalMs);

  // Анонимные уведомления о симпатии: очередь с задержкой 1–10 минут (правило 5).
  const notices = (now?: number) =>
    processNotices({
      db,
      redis,
      now,
      notify: (userId) => {
        io.to(userRoom(userId)).emit("inbox:changed");
        pushLater(userId, "sympathy");
      },
    });
  const noticeTimer = setInterval(() => void notices().catch(() => undefined), noticeIntervalMs);

  return {
    http,
    io,
    sweep,
    notices,
    close: async () => {
      clearInterval(timer);
      clearInterval(noticeTimer);
      await sub.unsubscribe(PRESENCE_CHANNEL, USER_CHANNEL).catch(() => undefined);
      await new Promise<void>((r) => io.close(() => r()));
    },
  };
};
