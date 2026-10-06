import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@ryadom/db";
import {
  endPresence,
  NOTICE_QUEUE_KEY,
  scheduleNotice,
  setOpenToMeet,
  startPresence,
} from "@ryadom/presence";
import { Redis } from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { processNotices } from "../src/notices";

const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL!);
const venueId = (await db.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } })).id;
const users: string[] = [];

const mkUser = async () => {
  const u = await db.user.create({
    data: {
      phone: `+7707${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Тест",
    },
  });
  users.push(u.id);
  return u.id;
};
const here = async (userId: string, open = true) => {
  await startPresence(redis, userId, venueId, randomUUID());
  if (open) await setOpenToMeet(redis, userId, true);
};
const like = (fromUserId: string, toUserId: string) =>
  db.sympathy.create({
    data: { fromUserId, toUserId, venueId, expiresAt: new Date(Date.now() + 3600_000) },
  });
const LATER = () => Date.now() + 11 * 60 * 1000;

beforeEach(async () => {
  for (const id of users) await endPresence(redis, id);
  await redis.del(NOTICE_QUEUE_KEY);
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
  redis.disconnect();
});

describe("анонимное уведомление о симпатии (правило 5)", () => {
  it("уходит через случайные 1–10 минут, а не сразу", async () => {
    const now = Date.now();
    for (let i = 0; i < 20; i++) await scheduleNotice(redis, `u${i}`, venueId, now);
    const scores = (await redis.zrange(NOTICE_QUEUE_KEY, 0, -1, "WITHSCORES"))
      .filter((_, i) => i % 2 === 1)
      .map(Number);
    for (const s of scores) {
      expect(s - now).toBeGreaterThanOrEqual(60_000);
      expect(s - now).toBeLessThanOrEqual(600_000);
    }
    expect(new Set(scores).size).toBeGreaterThan(1);
  });

  it("при N < 3 открытых к знакомству не отправляется и откладывается", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    await like(a, b);
    await scheduleNotice(redis, b, venueId);
    const notified: string[] = [];
    expect(await processNotices({ db, redis, notify: (u) => notified.push(u), now: LATER() })).toBe(
      0,
    );
    expect(notified).toEqual([]);
    expect(await db.notice.count({ where: { userId: b } })).toBe(0);
    expect(await redis.zscore(NOTICE_QUEUE_KEY, `${b}:${venueId}`)).not.toBeNull();
  });

  it("при N ≥ 3 — одно уведомление на несколько симпатий, без отправителя", async () => {
    const [a, c, b] = [await mkUser(), await mkUser(), await mkUser()];
    for (const u of [a, c, b]) await here(u);
    await like(a, b);
    await like(c, b);
    await scheduleNotice(redis, b, venueId);
    await scheduleNotice(redis, b, venueId); // второй раз не добавляет и не сдвигает
    expect(await redis.zcard(NOTICE_QUEUE_KEY)).toBe(1);

    const notified: string[] = [];
    expect(await processNotices({ db, redis, notify: (u) => notified.push(u), now: LATER() })).toBe(
      1,
    );
    expect(notified).toEqual([b]);
    const notices = await db.notice.findMany({ where: { userId: b } });
    expect(notices).toHaveLength(1);
    const text = JSON.stringify(notices);
    expect(text).not.toContain(a);
    expect(text).not.toContain(c);
  });

  it("получатель ушёл из заведения — уведомления нет", async () => {
    const [a, c, d, b] = [await mkUser(), await mkUser(), await mkUser(), await mkUser()];
    for (const u of [a, c, d, b]) await here(u);
    await like(a, b);
    await scheduleNotice(redis, b, venueId);
    await endPresence(redis, b);
    expect(await processNotices({ db, redis, notify: () => undefined, now: LATER() })).toBe(0);
    expect(await db.notice.count({ where: { userId: b } })).toBe(0);
  });

  it("симпатию сняли до отправки — уведомления нет", async () => {
    const [a, c, b] = [await mkUser(), await mkUser(), await mkUser()];
    for (const u of [a, c, b]) await here(u);
    const s = await like(a, b);
    await scheduleNotice(redis, b, venueId);
    await db.sympathy.delete({ where: { id: s.id } });
    expect(await processNotices({ db, redis, notify: () => undefined, now: LATER() })).toBe(0);
  });
});
