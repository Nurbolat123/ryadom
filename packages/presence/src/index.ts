import {
  newPresence,
  PUSH_KINDS,
  presenceKeys,
  PresenceSchema,
  RULES,
  type Presence,
  type PushKind,
} from "@ryadom/shared";
import type { Redis } from "ioredis";

/**
 * Присутствие в заведении — только в Redis, живёт не дольше 2 часов (правило 3).
 * Координат здесь нет (правило 4). Общий код для веб-приложения и realtime-сервиса.
 */

/** Заведения, где сейчас кто-то есть, — для очистки по TTL. */
export const ACTIVE_VENUES_KEY = "presence:venues";

const parse = (raw: string | null): Presence | null => {
  if (!raw) return null;
  const r = PresenceSchema.safeParse(JSON.parse(raw));
  return r.success ? r.data : null;
};

/** Текущее присутствие пользователя или null, если его нет или оно истекло. */
export const getPresence = async (redis: Redis, userId: string, now = Date.now()) => {
  const p = parse(await redis.get(presenceKeys.user(userId)));
  return p && p.expiresAt > now ? p : null;
};

/** Убрать присутствие (кнопка «Я ушёл(ла)», выход за геозону, чек-ин в другом месте). */
export const endPresence = async (redis: Redis, userId: string): Promise<Presence | null> => {
  const p = parse(await redis.get(presenceKeys.user(userId)));
  const tx = redis.multi().del(presenceKeys.user(userId));
  if (p)
    tx.zrem(presenceKeys.venue(p.venueId), userId).zrem(presenceKeys.venueOpen(p.venueId), userId);
  await tx.exec();
  return p;
};

/**
 * Начать присутствие. Режим «Открыт(а) к знакомству» всегда выключен (правило 2).
 * Предыдущее присутствие (в любом заведении) завершается и возвращается.
 */
export const startPresence = async (
  redis: Redis,
  userId: string,
  venueId: string,
  visitId: string,
  now = Date.now(),
): Promise<{ presence: Presence; previous: Presence | null }> => {
  const previous = await endPresence(redis, userId);
  const presence = newPresence(userId, venueId, visitId, now);
  await redis
    .multi()
    .set(presenceKeys.user(userId), JSON.stringify(presence), "PX", presence.expiresAt - now)
    .zadd(presenceKeys.venue(venueId), presence.expiresAt, userId)
    .pexpireat(presenceKeys.venue(venueId), presence.expiresAt)
    .sadd(ACTIVE_VENUES_KEY, venueId)
    .exec();
  return { presence, previous };
};

/** Включить/выключить «Открыт(а) к знакомству». TTL присутствия не продлевается. */
export const setOpenToMeet = async (
  redis: Redis,
  userId: string,
  open: boolean,
  now = Date.now(),
) => {
  const p = await getPresence(redis, userId, now);
  if (!p) return null;
  const next: Presence = { ...p, openToMeet: open };
  const tx = redis
    .multi()
    .set(presenceKeys.user(userId), JSON.stringify(next), "PXAT", p.expiresAt);
  if (open)
    tx.zadd(presenceKeys.venueOpen(p.venueId), p.expiresAt, userId).pexpireat(
      presenceKeys.venueOpen(p.venueId),
      p.expiresAt,
    );
  else tx.zrem(presenceKeys.venueOpen(p.venueId), userId);
  await tx.exec();
  return next;
};

/** Сколько человек в заведении открыты к знакомству (истёкшие вычищаются). */
export const countOpenToMeet = async (redis: Redis, venueId: string, now = Date.now()) => {
  await redis.zremrangebyscore(presenceKeys.venueOpen(venueId), "-inf", now);
  return redis.zcard(presenceKeys.venueOpen(venueId));
};

/** userId всех, кто сейчас в заведении (для этапа 5). */
export const listPresent = async (redis: Redis, venueId: string, now = Date.now()) => {
  await redis.zremrangebyscore(presenceKeys.venue(venueId), "-inf", now);
  return redis.zrange(presenceKeys.venue(venueId), 0, -1);
};

/**
 * Очистка истёкших присутствий (TTL 2 часа). Возвращает, кого из каких заведений убрали,
 * чтобы realtime-сервис обновил списки и сообщил людям, что отметка закончилась.
 */
export const sweepExpired = async (redis: Redis, now = Date.now()) => {
  const removed: { venueId: string; userIds: string[] }[] = [];
  for (const venueId of await redis.smembers(ACTIVE_VENUES_KEY)) {
    const key = presenceKeys.venue(venueId);
    const expired = await redis.zrangebyscore(key, "-inf", now);
    if (expired.length) {
      await redis
        .multi()
        .zremrangebyscore(key, "-inf", now)
        .zremrangebyscore(presenceKeys.venueOpen(venueId), "-inf", now)
        .exec();
      removed.push({ venueId, userIds: expired });
    }
    if ((await redis.zcard(key)) === 0) await redis.srem(ACTIVE_VENUES_KEY, venueId);
  }
  return removed;
};

/**
 * Шина событий присутствия: веб-API публикует, realtime-сервис рассылает в комнаты.
 * В событии нет ничего, кроме id заведения и пользователя: ни координат, ни симпатий.
 */
export const PRESENCE_CHANNEL = "ryadom:presence";

export type PresenceEvent = {
  type: "joined" | "left" | "open" | "closed";
  venueId: string;
  userId: string;
};

export const publishPresenceEvent = (redis: Redis, event: PresenceEvent) =>
  redis.publish(PRESENCE_CHANNEL, JSON.stringify(event));

export const parsePresenceEvent = (raw: string): PresenceEvent | null => {
  try {
    const e = JSON.parse(raw) as PresenceEvent;
    return ["joined", "left", "open", "closed"].includes(e.type) && e.venueId && e.userId
      ? e
      : null;
  } catch {
    return null;
  }
};

/**
 * Личные события пользователя: веб-API публикует, realtime шлёт в комнату user:<id>.
 * Только тип и id чата — без имён, текстов и признаков отправителя симпатии.
 */
export const USER_CHANNEL = "ryadom:user";

export type UserEvent =
  /** Взаимная симпатия: обоим сразу, с id нового чата. */
  | { type: "match"; userId: string; chatId: string }
  /** Входящие изменились (новый привет или анонимное уведомление). push — вид уведомления, если нужно. */
  | { type: "inbox"; userId: string; push?: PushKind }
  /** В чате новое сообщение или изменение (ответ на привет, обмен контактами). */
  | { type: "chat"; userId: string; chatId: string; push?: PushKind }
  /** Блокировка: обновить всё (список, входящие, чаты). Кто и кого — не передаётся. */
  | { type: "refresh"; userId: string }
  /** Аккаунт заблокирован модератором: закрыть подключения. */
  | { type: "logout"; userId: string };

const isPushKind = (v: unknown): v is PushKind =>
  typeof v === "string" && (PUSH_KINDS as readonly string[]).includes(v);

export const publishUserEvent = (redis: Redis, event: UserEvent) =>
  redis.publish(USER_CHANNEL, JSON.stringify(event));

export const parseUserEvent = (raw: string): UserEvent | null => {
  try {
    const e = JSON.parse(raw) as UserEvent;
    if (!e.userId) return null;
    const push = "push" in e && isPushKind(e.push) ? { push: e.push } : {};
    if (e.type === "inbox") return { type: e.type, userId: e.userId, ...push };
    if (e.type === "refresh" || e.type === "logout") return { type: e.type, userId: e.userId };
    if (e.type === "match" && e.chatId) return { type: e.type, userId: e.userId, chatId: e.chatId };
    if (e.type === "chat" && e.chatId)
      return { type: e.type, userId: e.userId, chatId: e.chatId, ...push };
    return null;
  } catch {
    return null;
  }
};

/**
 * Очередь анонимных уведомлений о симпатии (правило 5).
 * Элемент — пара «получатель:заведение»: несколько симпатий подряд в одном заведении
 * дают одно уведомление (ZADD NX не сдвигает уже запланированное).
 * Время отправки — сейчас + случайно 1–10 минут, чтобы по времени нельзя было вычислить отправителя.
 */
export const NOTICE_QUEUE_KEY = "notice:queue";

export const noticeDelayMs = (random = Math.random) => {
  const { min, max } = RULES.anonymousNoticeDelaySeconds;
  return Math.round((min + random() * (max - min)) * 1000);
};

export const scheduleNotice = (
  redis: Redis,
  toUserId: string,
  venueId: string,
  now = Date.now(),
  random = Math.random,
) => redis.zadd(NOTICE_QUEUE_KEY, "NX", now + noticeDelayMs(random), `${toUserId}:${venueId}`);

/** Забрать наступившие элементы очереди (атомарно, чтобы два процесса не отправили дважды). */
export const takeDueNotices = async (redis: Redis, now = Date.now()) => {
  const due = await redis.zrangebyscore(NOTICE_QUEUE_KEY, "-inf", now);
  const taken: { toUserId: string; venueId: string }[] = [];
  for (const member of due) {
    if ((await redis.zrem(NOTICE_QUEUE_KEY, member)) !== 1) continue;
    const [toUserId, venueId] = member.split(":");
    if (toUserId && venueId) taken.push({ toUserId, venueId });
  }
  return taken;
};
