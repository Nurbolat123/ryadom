import { presenceKeys, RULES } from "@ryadom/shared";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import {
  countOpenToMeet,
  endPresence,
  getPresence,
  listPresent,
  setOpenToMeet,
  startPresence,
  sweepExpired,
} from "../src";

const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
const id = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
afterAll(() => redis.disconnect());

describe("присутствие в Redis", () => {
  it("после чек-ина режим «открыт(а)» выключен (правило 2), TTL не больше 2 часов (правило 3)", async () => {
    const [u, v] = [id("u"), id("v")];
    const { presence } = await startPresence(redis, u, v, "visit1");
    expect(presence.openToMeet).toBe(false);
    expect(presence.expiresAt - presence.startedAt).toBe(RULES.presenceTtlSeconds * 1000);
    const ttl = await redis.pttl(presenceKeys.user(u));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(RULES.presenceTtlSeconds * 1000);
    expect(JSON.stringify(await getPresence(redis, u))).not.toMatch(/lat|lng|lon/);
    await endPresence(redis, u);
  });

  it("истёкшее присутствие не возвращается и не считается", async () => {
    const [u, v] = [id("u"), id("v")];
    await startPresence(redis, u, v, "visit1");
    // спустя 2 часа и 1 секунду (даже если ключ в Redis ещё не удалён)
    const later = Date.now() + RULES.presenceTtlSeconds * 1000 + 1000;
    await setOpenToMeet(redis, u, true);
    expect(await getPresence(redis, u, later)).toBeNull();
    expect(await listPresent(redis, v, later)).not.toContain(u);
    expect(await countOpenToMeet(redis, v, later)).toBe(0);
    await endPresence(redis, u);
  });

  it("чек-ин в другом месте завершает предыдущее присутствие", async () => {
    const [u, v1, v2] = [id("u"), id("v"), id("v")];
    await startPresence(redis, u, v1, "a");
    const { previous } = await startPresence(redis, u, v2, "b");
    expect(previous?.venueId).toBe(v1);
    expect(await listPresent(redis, v1)).not.toContain(u);
    expect(await listPresent(redis, v2)).toContain(u);
    await endPresence(redis, u);
  });

  it("«Я ушёл(ла)» убирает человека из заведения и из открытых", async () => {
    const [u, v] = [id("u"), id("v")];
    await startPresence(redis, u, v, "a");
    await setOpenToMeet(redis, u, true);
    expect(await countOpenToMeet(redis, v)).toBe(1);
    await endPresence(redis, u);
    expect(await getPresence(redis, u)).toBeNull();
    expect(await listPresent(redis, v)).toEqual([]);
    expect(await countOpenToMeet(redis, v)).toBe(0);
  });

  it("очистка по TTL сообщает, кого убрать из заведения", async () => {
    const [u, v] = [id("u"), id("v")];
    await startPresence(redis, u, v, "a");
    await setOpenToMeet(redis, u, true);
    expect(await sweepExpired(redis)).not.toContainEqual(expect.objectContaining({ venueId: v }));
    const later = Date.now() + RULES.presenceTtlSeconds * 1000 + 1000;
    expect(await sweepExpired(redis, later)).toContainEqual({ venueId: v, userIds: [u] });
    expect(await redis.zcard(presenceKeys.venueOpen(v))).toBe(0);
    await endPresence(redis, u);
  });
});
