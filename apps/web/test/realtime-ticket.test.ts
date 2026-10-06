import { afterAll, describe, expect, it } from "vitest";
import { jar } from "./cookies-mock";

const { prisma } = await import("@ryadom/db");
const { realtimeTicketKey } = await import("@ryadom/shared");
const { POST: ticket } = await import("@/app/api/realtime/ticket/route");
const { redis } = await import("@/lib/redis");
const { sha256 } = await import("@/lib/server/hash");
const { startSession } = await import("@/lib/server/session");

const users: string[] = [];
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("билет для realtime", () => {
  it("без входа — 401", async () => {
    jar.clear();
    expect((await ticket()).status).toBe(401);
  });

  it("выдаётся на минуту, в Redis только хэш", async () => {
    const u = await prisma.user.create({
      data: {
        phone: "+77060000001",
        birthDate: new Date("1995-01-01"),
        gender: "male",
        displayName: "Тест",
      },
    });
    users.push(u.id);
    jar.clear();
    await startSession({ userId: u.id });
    const { ticket: t } = (await (await ticket()).json()) as { ticket: string };
    const key = realtimeTicketKey(sha256(t));
    expect(await redis.get(key)).toBe(u.id);
    expect(await redis.ttl(key)).toBeLessThanOrEqual(60);
    expect(await redis.exists(`rt-ticket:${t}`)).toBe(0);
  });
});
