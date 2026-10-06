import { newPresence, presenceKeys, PresenceSchema, type Presence } from "@ryadom/shared";
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
