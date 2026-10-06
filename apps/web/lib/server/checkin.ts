import {
  findVenuesAtPoint,
  isPointInVenue,
  prisma,
  type User,
  type VenueCandidate,
} from "@ryadom/db";
import {
  countOpenToMeet,
  endPresence,
  getPresence,
  publishPresenceEvent,
  startPresence,
} from "@ryadom/presence";
import { LatLngSchema, RULES, todayIn, type Presence } from "@ryadom/shared";
import { z } from "zod";
import { redis } from "../redis";

/**
 * Чек-ин по геолокации.
 * Точка пользователя используется только внутри запроса к PostGIS и нигде не сохраняется:
 * ни в базе, ни в Redis, ни в логах, ни в ответах API (правило 4).
 */

export const PositionSchema = LatLngSchema.extend({
  /** Точность в метрах, как её отдаёт браузер (coords.accuracy). */
  accuracy: z.number().positive().max(100_000),
}).strict();
export type Position = z.infer<typeof PositionSchema>;

/** Кандидаты, из которых человек может выбрать заведение, живут 5 минут. */
const CANDIDATES_TTL_SEC = 5 * 60;
const candidatesKey = (userId: string) => `checkin:candidates:${userId}`;

export type PublicCandidate = Pick<
  VenueCandidate,
  "id" | "slug" | "name" | "category" | "address" | "isPartner"
>;

export type LocateResult =
  { ok: true; venues: PublicCandidate[] } | { ok: false; error: "low_accuracy" };

/** Найти заведения, в геозоне которых сейчас человек (до 5, ближайшие первыми). */
export const locate = async (userId: string, pos: Position): Promise<LocateResult> => {
  if (pos.accuracy > RULES.maxGpsAccuracyMeters) return { ok: false, error: "low_accuracy" };
  const found = await findVenuesAtPoint(prisma, [pos.lng, pos.lat], RULES.maxVenueCandidates);
  const key = candidatesKey(userId);
  const tx = redis.multi().del(key);
  if (found.length) tx.sadd(key, ...found.map((v) => v.id)).expire(key, CANDIDATES_TTL_SEC);
  await tx.exec();
  return {
    ok: true,
    venues: found.map(({ id, slug, name, category, address, isPartner }) => ({
      id,
      slug,
      name,
      category,
      address,
      isPartner,
    })),
  };
};

const publicVenue = (venueId: string) =>
  prisma.venue.findUnique({
    where: { id: venueId },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      address: true,
      isPartner: true,
      timezone: true,
    },
  });

export type CurrentCheckin = {
  venue: {
    id: string;
    slug: string;
    name: string;
    category: string;
    address: string | null;
    isPartner: boolean;
  };
  openToMeet: boolean;
  expiresAt: string;
  /** «Здесь сейчас N человек открыты к знакомству» — только если N ≥ 3, иначе null. */
  openCount: number | null;
};

const toCurrent = async (p: Presence): Promise<CurrentCheckin | null> => {
  const venue = await publicVenue(p.venueId);
  if (!venue) return null;
  const n = await countOpenToMeet(redis, p.venueId);
  return {
    venue: {
      id: venue.id,
      slug: venue.slug,
      name: venue.name,
      category: venue.category,
      address: venue.address,
      isPartner: venue.isPartner,
    },
    openToMeet: p.openToMeet,
    expiresAt: new Date(p.expiresAt).toISOString(),
    openCount: n >= RULES.minActivityToShow ? n : null,
  };
};

/** Закрыть визиты, у которых присутствие уже истекло (TTL 2 часа) или завершено. */
const closeOpenVisits = async (userId: string, now = new Date()) => {
  const open = await prisma.visit.findMany({
    where: { userId, endedAt: null },
    select: { id: true, startedAt: true },
  });
  for (const v of open) {
    const maxEnd = new Date(v.startedAt.getTime() + RULES.presenceTtlSeconds * 1000);
    await prisma.visit.update({
      where: { id: v.id },
      data: { endedAt: maxEnd < now ? maxEnd : now },
    });
  }
};

export type ConfirmResult =
  { ok: true; checkin: CurrentCheckin } | { ok: false; error: "not_here" | "profile_incomplete" };

/**
 * Подтвердить чек-ин в выбранном заведении. Выбрать можно только из кандидатов,
 * найденных по геолокации за последние 5 минут: удалённо, по ссылке или вне геозоны — нельзя (правило 1).
 */
export const confirmCheckin = async (user: User, venueId: string): Promise<ConfirmResult> => {
  if (!user.verifiedAt || !user.photo) return { ok: false, error: "profile_incomplete" };
  const allowed = await redis.sismember(candidatesKey(user.id), venueId);
  if (!allowed) return { ok: false, error: "not_here" };
  const venue = await prisma.venue.findFirst({
    where: { id: venueId, isActive: true },
    select: { timezone: true },
  });
  if (!venue) return { ok: false, error: "not_here" };

  const previous = await endPresence(redis, user.id);
  if (previous)
    await publishPresenceEvent(redis, { type: "left", venueId: previous.venueId, userId: user.id });
  await closeOpenVisits(user.id);
  const visit = await prisma.visit.create({ data: { userId: user.id, venueId } });
  const { presence } = await startPresence(redis, user.id, venueId, visit.id);
  await redis.del(candidatesKey(user.id));
  await publishPresenceEvent(redis, { type: "joined", venueId, userId: user.id });
  // Аналитика — обезличенно: тип, заведение, день (без userId).
  await prisma.analyticsEvent.create({
    data: { type: "checkin", venueId, day: new Date(`${todayIn(venue.timezone)}T00:00:00Z`) },
  });

  const checkin = await toCurrent(presence);
  if (!checkin) return { ok: false, error: "not_here" };
  return { ok: true, checkin };
};

/** «Я ушёл(ла)». */
export const leave = async (userId: string) => {
  const ended = await endPresence(redis, userId);
  if (ended) await publishPresenceEvent(redis, { type: "left", venueId: ended.venueId, userId });
  await closeOpenVisits(userId);
};

/** Текущий чек-ин или null; заодно закрывает визиты с истёкшим присутствием. */
export const currentCheckin = async (userId: string): Promise<CurrentCheckin | null> => {
  const p = await getPresence(redis, userId);
  if (!p) {
    await closeOpenVisits(userId);
    return null;
  }
  return toCurrent(p);
};

export type RecheckResult = { status: "here" | "left" | "uncertain" | "none" };

/**
 * Перепроверка при повторном открытии приложения (правило 3):
 * точка вне геозоны — присутствие завершается; точность плохая — оставляем как есть.
 * TTL при этом не продлевается.
 */
export const recheck = async (userId: string, pos: Position): Promise<RecheckResult> => {
  const p = await getPresence(redis, userId);
  if (!p) return { status: "none" };
  if (pos.accuracy > RULES.maxGpsAccuracyMeters) return { status: "uncertain" };
  if (await isPointInVenue(prisma, p.venueId, [pos.lng, pos.lat])) return { status: "here" };
  await leave(userId);
  return { status: "left" };
};
