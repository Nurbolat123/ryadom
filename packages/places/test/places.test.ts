import { createPrismaClient } from "@ryadom/db";
import { setOpenToMeet, startPresence, endPresence } from "@ryadom/presence";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import {
  ACTIVITY_KEY,
  issueOfferCode,
  moderateOffer,
  partnerReport,
  popularHours,
  readActivity,
  redeemOfferCode,
  snapshotActivity,
  topVenuesOfWeek,
} from "../src";

const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const venue = await db.venue.findUniqueOrThrow({ where: { slug: "kofe-kitap" } });
const other = await db.venue.findUniqueOrThrow({ where: { slug: "bar-polka" } });
const tz = venue.timezone;

// Статистика пишется в даты 2020 года, чтобы не смешиваться с данными разработки.
const PAST = new Date("2020-03-02T09:30:00Z"); // понедельник
const userIds: string[] = [];
const offerIds: string[] = [];

const openUsers = async (venueId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const id = `places-test-${venueId}-${userIds.length}`;
    userIds.push(id);
    await startPresence(redis, id, venueId, `visit-${id}`);
    await setOpenToMeet(redis, id, true);
  }
};

type OfferData = {
  status?: "pending" | "approved";
  type?: "discount" | "event";
  title?: string;
  titleKk?: string;
};
const mkOffer = (data: OfferData = {}) =>
  db.offer
    .create({
      data: {
        venueId: venue.id,
        type: "discount",
        placement: "badge",
        title: "2 капучино по цене 1",
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 86_400_000),
        status: "approved",
        ...data,
      },
    })
    .then((o) => {
      offerIds.push(o.id);
      return o;
    });

afterAll(async () => {
  for (const id of userIds) await endPresence(redis, id);
  await redis.del(ACTIVITY_KEY);
  await db.offer.deleteMany({ where: { id: { in: offerIds } } });
  await db.venueStatsHourly.deleteMany({
    where: { date: { gte: new Date("2020-01-01"), lt: new Date("2021-01-01") } },
  });
  await db.$disconnect();
  redis.disconnect();
});

describe("активность заведений", () => {
  it("хранит только диапазон, меньше 3 не показывает", async () => {
    await openUsers(other.id, 2);
    await openUsers(venue.id, 6);
    const buckets = await snapshotActivity({ db, redis, now: PAST });
    expect(buckets[venue.id]).toBe("5-10");
    expect(buckets[other.id]).toBeUndefined();
    const stored = await readActivity(redis);
    expect(stored[venue.id]).toBe("5-10");
    expect(stored[other.id]).toBeUndefined();
    // В Redis нет точных чисел.
    expect(Object.values(stored).every((v) => ["3-5", "5-10", "10+"].includes(v))).toBe(true);
  });

  it("в почасовую статистику пишется только пик за час", async () => {
    const row = await db.venueStatsHourly.findFirstOrThrow({
      where: { venueId: venue.id, date: new Date("2020-03-02") },
    });
    expect(row.openPeak).toBe(6);
    expect(Object.keys(row).sort()).toEqual(["checkins", "date", "hour", "openPeak", "venueId"]);
  });

  it("популярные часы: в среднем меньше 3 — тихий час", async () => {
    // 6 недель: понедельник 20:00 — по 8 человек, вторник 20:00 — по 2.
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const mon = new Date(Date.UTC(2020, 5, 1 + w * 7)); // 2020-06-01 — понедельник
      rows.push({ venueId: other.id, date: mon, hour: 20, openPeak: 8, checkins: 0 });
      rows.push({
        venueId: other.id,
        date: new Date(mon.getTime() + 86_400_000),
        hour: 20,
        openPeak: 2,
        checkins: 0,
      });
    }
    await db.venueStatsHourly.createMany({ data: rows });
    const grid = await popularHours(db, other.id, tz, new Date("2020-07-13T06:00:00Z"));
    expect(grid[0]![20]).toBe(3);
    expect(grid[1]![20]).toBe(0);
    expect(grid.flat().filter((l) => l > 0)).toHaveLength(1);
  });

  it("топ недели не учитывает часы, где было меньше 3 человек", async () => {
    await db.venueStatsHourly.createMany({
      data: [
        { venueId: venue.id, date: new Date("2020-09-10"), hour: 19, openPeak: 4, checkins: 0 },
        ...Array.from({ length: 10 }, (_, h) => ({
          venueId: other.id,
          date: new Date("2020-09-10"),
          hour: h,
          openPeak: 2,
          checkins: 0,
        })),
      ],
    });
    const top = await topVenuesOfWeek(db, venue.city, new Date("2020-09-12T12:00:00Z"));
    expect(top).toEqual([venue.id]);
  });
});

describe("предложения и коды", () => {
  it("код выдаётся только по одобренной действующей скидке и не связан с человеком", async () => {
    const pending = await mkOffer({ status: "pending" });
    expect(await issueOfferCode(db, pending.id)).toBeNull();
    const event = await mkOffer({ type: "event" });
    expect(await issueOfferCode(db, event.id)).toBeNull();
    const offer = await mkOffer();
    const r = await issueOfferCode(db, offer.id);
    expect(r?.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const row = await db.offerRedemption.findUniqueOrThrow({ where: { code: r!.code } });
    expect(Object.keys(row).sort()).toEqual([
      "code",
      "createdAt",
      "expiresAt",
      "id",
      "offerId",
      "redeemedAt",
    ]);
  });

  it("погашение: один раз, только в своём заведении, не после срока", async () => {
    const offer = await mkOffer();
    const { code } = (await issueOfferCode(db, offer.id))!;
    expect(await redeemOfferCode(db, other.id, code)).toEqual({ ok: false, error: "not_found" });
    expect(await redeemOfferCode(db, venue.id, code.toLowerCase())).toEqual({
      ok: true,
      title: offer.title,
    });
    expect(await redeemOfferCode(db, venue.id, code)).toEqual({ ok: false, error: "used" });
    await db.offerRedemption.create({
      data: { offerId: offer.id, code: "OLD234", expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await redeemOfferCode(db, venue.id, "OLD234")).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await redeemOfferCode(db, venue.id, "NOPE99")).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("отчёт партнёру: показы, переходы, коды, погашения — без людей", async () => {
    const r = await partnerReport(db, venue.id, 7);
    expect(Object.keys(r).sort()).toEqual(["clicks", "codesIssued", "impressions", "redemptions"]);
    expect(r.codesIssued).toBeGreaterThanOrEqual(3);
    expect(r.redemptions).toBeGreaterThanOrEqual(1);
    expect(r.clicks).toBeGreaterThanOrEqual(2);
  });

  it("предложение с алкоголем одобрить нельзя", async () => {
    const beer = await mkOffer({ status: "pending", title: "Пиво 1+1 по пятницам" });
    expect(await moderateOffer(db, beer.id, "approved")).toEqual({ ok: false, error: "alcohol" });
    expect((await db.offer.findUniqueOrThrow({ where: { id: beer.id } })).status).toBe("pending");
    expect(await moderateOffer(db, beer.id, "rejected")).toEqual({ ok: true });
    // «Сыра» по-казахски — пиво; в русском тексте это «сыр».
    const kk = await mkOffer({ status: "pending", title: "Вечерняя акция", titleKk: "Сыра тегін" });
    expect(await moderateOffer(db, kk.id, "approved")).toEqual({ ok: false, error: "alcohol" });
    const cheese = await mkOffer({ status: "pending", title: "Паста без сыра −20%" });
    expect(await moderateOffer(db, cheese.id, "approved")).toEqual({ ok: true });
    const coffee = await mkOffer({ status: "pending", title: "Шоколадный торт со скидкой" });
    expect(await moderateOffer(db, coffee.id, "approved")).toEqual({ ok: true });
  });
});
