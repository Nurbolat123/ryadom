import type { PrismaClient } from "@ryadom/db";
import { ACTIVE_VENUES_KEY, countOpenToMeet } from "@ryadom/presence";
import { activityBucket, localTimeIn, RULES, type ActivityBucket } from "@ryadom/shared";
import type { Redis } from "ioredis";

/**
 * Живая активность заведений для «Где знакомятся сейчас».
 * - Пересчёт раз в 5 минут (realtime), не моментально: по списку нельзя отследить,
 *   кто только что пришёл или ушёл.
 * - В Redis хранится только диапазон («3-5», «5-10», «10+»), меньше 3 — ничего.
 * - В почасовую статистику (VenueStatsHourly) пишется только пик за час — агрегат без людей.
 */
export const ACTIVITY_KEY = "activity:buckets";

export const snapshotActivity = async ({
  db,
  redis,
  now = new Date(),
}: {
  db: PrismaClient;
  redis: Redis;
  now?: Date;
}) => {
  const venueIds = await redis.smembers(ACTIVE_VENUES_KEY);
  const counts = new Map<string, number>();
  for (const id of venueIds) counts.set(id, await countOpenToMeet(redis, id, now.getTime()));

  const buckets: Record<string, ActivityBucket> = {};
  for (const [id, n] of counts) {
    const b = activityBucket(n);
    if (b) buckets[id] = b;
  }
  const multi = redis.multi().del(ACTIVITY_KEY);
  if (Object.keys(buckets).length) multi.hset(ACTIVITY_KEY, buckets);
  await multi.exec();

  // Пик открытых к знакомству за местный час заведения.
  const venues = await db.venue.findMany({
    where: { id: { in: [...counts.keys()].filter((id) => (counts.get(id) ?? 0) > 0) } },
    select: { id: true, timezone: true },
  });
  for (const v of venues) {
    const { date, hour } = localTimeIn(v.timezone, now);
    const n = counts.get(v.id) ?? 0;
    await db.$executeRaw`
      INSERT INTO "VenueStatsHourly" ("venueId", "date", "hour", "openPeak", "checkins")
      VALUES (${v.id}, ${date}::date, ${hour}, ${n}, 0)
      ON CONFLICT ("venueId", "date", "hour")
      DO UPDATE SET "openPeak" = GREATEST("VenueStatsHourly"."openPeak", EXCLUDED."openPeak")`;
  }
  return buckets;
};

/** Текущие диапазоны активности (из последнего пересчёта). */
export const readActivity = async (redis: Redis): Promise<Record<string, ActivityBucket>> =>
  (await redis.hgetall(ACTIVITY_KEY)) as Record<string, ActivityBucket>;

/** Чек-ин — в почасовую статистику (только счётчик). */
export const recordCheckin = async (
  db: PrismaClient,
  venueId: string,
  timezone: string,
  now = new Date(),
) => {
  const { date, hour } = localTimeIn(timezone, now);
  await db.$executeRaw`
    INSERT INTO "VenueStatsHourly" ("venueId", "date", "hour", "openPeak", "checkins")
    VALUES (${venueId}, ${date}::date, ${hour}, 0, 1)
    ON CONFLICT ("venueId", "date", "hour")
    DO UPDATE SET "checkins" = "VenueStatsHourly"."checkins" + 1`;
};

/** 0 — тихо (или меньше 3 человек), 1–3 — от «бывает людно» до «пик». Чисел нет. */
export type HourLevel = 0 | 1 | 2 | 3;

const dayMs = 86_400_000;

/**
 * Популярные часы по дням недели за прошлые 6 недель (без сегодняшнего дня).
 * Часы, где в среднем меньше 3 открытых к знакомству, считаются тихими: так по графику
 * нельзя восстановить визиты отдельных людей.
 */
export const popularHours = async (
  db: PrismaClient,
  venueId: string,
  timezone: string,
  now = new Date(),
): Promise<HourLevel[][]> => {
  const today = localTimeIn(timezone, now).date;
  const from = new Date(
    new Date(`${today}T00:00:00Z`).getTime() - RULES.popularHoursWeeks * 7 * dayMs,
  );
  const rows = await db.venueStatsHourly.findMany({
    where: { venueId, date: { gte: from, lt: new Date(`${today}T00:00:00Z`) } },
    select: { date: true, hour: true, openPeak: true },
  });
  // Сумма пиков по (день недели, час); делим на число недель — дни без записей считаются тихими.
  const sum = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const r of rows) {
    const weekday = (r.date.getUTCDay() + 6) % 7;
    sum[weekday]![r.hour]! += r.openPeak;
  }
  const avg = sum.map((d) => d.map((s) => s / RULES.popularHoursWeeks));
  const max = Math.max(...avg.flat());
  return avg.map((d) =>
    d.map((a): HourLevel => {
      if (a < RULES.minOpenPeopleForAnonymousNotice || max === 0) return 0;
      const rel = a / max;
      return rel > 0.75 ? 3 : rel > 0.4 ? 2 : 1;
    }),
  );
};

/**
 * «Топ мест недели»: сумма часовых пиков за 7 дней, только часы с пиком ≥ 3.
 * Наружу — только порядок мест, без чисел.
 */
export const topVenuesOfWeek = async (
  db: PrismaClient,
  city: string,
  now = new Date(),
  limit = 10,
) => {
  const from = new Date(now.getTime() - 7 * dayMs);
  const rows = await db.$queryRaw<{ venueId: string; score: bigint }[]>`
    SELECT s."venueId", SUM(s."openPeak") AS score
    FROM "VenueStatsHourly" s
    JOIN "Venue" v ON v.id = s."venueId"
    WHERE v.city = ${city} AND v."isActive" = true
      AND s."date" >= ${from.toISOString().slice(0, 10)}::date
      AND s."date" <= ${now.toISOString().slice(0, 10)}::date
      AND s."openPeak" >= ${RULES.minOpenPeopleForAnonymousNotice}
    GROUP BY s."venueId"
    ORDER BY score DESC
    LIMIT ${limit}`;
  return rows.map((r) => r.venueId);
};
