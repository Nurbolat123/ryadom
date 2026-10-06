import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { GIFT_CHANNEL, setPaymentProvider, StubPaymentProvider } = await import("@ryadom/gifts");
const { endPresence, setOpenToMeet, startPresence, USER_CHANNEL } =
  await import("@ryadom/presence");
const { GET: menu } = await import("@/app/api/here/menu/route");
const { POST: gift } = await import("@/app/api/people/[id]/gift/route");
const { GET: gifts } = await import("@/app/api/gifts/route");
const { POST: accept } = await import("@/app/api/gifts/[id]/accept/route");
const { POST: decline } = await import("@/app/api/gifts/[id]/decline/route");
const { POST: block } = await import("@/app/api/people/[id]/block/route");
const { GET: people } = await import("@/app/api/here/people/route");
const { GET: badges } = await import("@/app/api/badges/route");
const { GET: adminGifts } = await import("@/app/api/admin/gifts/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");
const { banUser } = await import("@/lib/server/safety");

const payments = new StubPaymentProvider();
setPaymentProvider(payments);

const TEPLYI = await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const POLKA = await prisma.venue.findUniqueOrThrow({ where: { slug: "bar-polka" } });
const items = await prisma.menuItem.findMany({ where: { venueId: TEPLYI.id } });
const coffee = items.find((i) => i.giftable && !i.isAlcohol && i.isAvailable)!;
const nonGiftable = await prisma.menuItem.findFirstOrThrow({ where: { giftable: false } });
const alcohol = await prisma.menuItem.findFirstOrThrow({ where: { isAlcohol: true } });

const users: string[] = [];
const mkUser = async (name = "Тест") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: name,
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
    },
  });
  users.push(u.id);
  return u;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
/** Настоящий визит (подарок привязан к визиту отправителя) + присутствие. */
const here = async (userId: string, venueId = TEPLYI.id) => {
  const visit = await prisma.visit.create({ data: { userId, venueId } });
  await startPresence(redis, userId, venueId, visit.id);
  await setOpenToMeet(redis, userId, true);
  return visit.id;
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const send = async (from: string, to: string, menuItemId = coffee.id, note?: string) => {
  await as(from);
  return gift(req({ menuItemId, note }), ctx(to));
};
const giftId = async (res: Response) => ((await res.json()) as { giftId: string }).giftId;
const listen = async (channel: string) => {
  const sub = redis.duplicate();
  const events: Record<string, string>[] = [];
  await sub.subscribe(channel);
  sub.on("message", (_c, m) => events.push(JSON.parse(m)));
  return {
    events,
    stop: async () => {
      await new Promise((r) => setTimeout(r, 100));
      sub.disconnect();
    },
  };
};
const pair = async () => {
  const [a, b] = [await mkUser("Даурен"), await mkUser("Алия")];
  await here(a.id);
  await here(b.id);
  return [a, b] as const;
};

beforeEach(async () => {
  jar.clear();
  for (const id of users) await endPresence(redis, id);
  for (const k of await redis.keys("rl:gift:*")) await redis.del(k);
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  await prisma.gift.deleteMany({
    where: { OR: [{ fromUserId: { in: users } }, { toUserId: { in: users } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("меню «Угостить» (правило 8)", () => {
  it("только giftable, без алкоголя; только у партнёра и только при чек-ине", async () => {
    const a = await mkUser();
    await as(a.id);
    expect((await menu()).status).toBe(403);
    await here(a.id, POLKA.id);
    expect((await menu()).status).toBe(404); // не партнёр
    await here(a.id);
    const body = (await (await menu()).json()) as { items: { id: string }[] };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain(coffee.id);
    for (const id of ids) {
      const i = items.find((x) => x.id === id)!;
      expect(i.giftable && !i.isAlcohol && i.isAvailable).toBe(true);
    }
    expect(ids).not.toContain(alcohol.id);
    expect(JSON.stringify(body)).not.toMatch(/isAlcohol|giftable/);
  });

  it("алкоголь и не-giftable подарить нельзя даже по прямому id", async () => {
    const [a, b] = await pair();
    expect((await send(a.id, b.id, alcohol.id)).status).toBe(409);
    expect((await send(a.id, b.id, nonGiftable.id)).status).toBe(409);
    expect(await prisma.gift.count({ where: { fromUserId: a.id } })).toBe(0);
  });

  it("дороже лимита заведения — нельзя", async () => {
    const [a, b] = await pair();
    await prisma.venue.update({
      where: { id: TEPLYI.id },
      data: { maxGiftAmount: coffee.price - 1 },
    });
    try {
      expect((await send(a.id, b.id)).status).toBe(409);
    } finally {
      await prisma.venue.update({ where: { id: TEPLYI.id }, data: { maxGiftAmount: null } });
    }
  });
});

describe("отправка подарка", () => {
  it("только тому, кого видишь, и только у партнёра", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a.id);
    expect((await send(a.id, b.id)).status).toBe(404); // b не здесь
    await here(b.id, POLKA.id);
    await here(a.id, POLKA.id);
    expect((await send(a.id, b.id)).status).toBe(404); // не партнёр
    expect((await send(a.id, a.id)).status).toBe(404);
  });

  it("оплата, комиссия, событие только получателю; один подарок человеку за визит", async () => {
    const [a, b] = await pair();
    const bus = await listen(USER_CHANNEL);
    const res = await send(a.id, b.id, coffee.id, "Хорошего вечера!");
    await bus.stop();
    expect(res.status).toBe(201);
    const g = await prisma.gift.findUniqueOrThrow({ where: { id: await giftId(res) } });
    expect(g).toMatchObject({ status: "pending", amount: coffee.price, note: "Хорошего вечера!" });
    expect(g.commission).toBe(Math.round(coffee.price * 0.12));
    expect(payments.charges.get(g.paymentId!)).toBe(coffee.price);
    expect(g.expiresAt.getTime() - g.createdAt.getTime()).toBe(2 * 3600_000);
    expect(bus.events).toEqual([{ type: "inbox", userId: b.id }]);

    expect((await send(a.id, b.id)).status).toBe(409);
    // В списке людей — «Ты угостил(а)».
    await as(a.id);
    const list = (await (await people()).json()) as { people: { id: string; giftSent: boolean }[] };
    expect(list.people.find((p) => p.id === b.id)?.giftSent).toBe(true);
    // Новый визит — можно снова.
    await here(a.id);
    expect((await send(a.id, b.id)).status).toBe(201);
  });

  it("не больше 3 подарков в день от отправителя", async () => {
    const a = await mkUser();
    await here(a.id);
    for (let i = 0; i < 3; i++) {
      const b = await mkUser();
      await here(b.id);
      expect((await send(a.id, b.id)).status).toBe(201);
    }
    const d = await mkUser();
    await here(d.id);
    expect((await send(a.id, d.id)).status).toBe(429);
  });

  it("оплата не прошла — подарка нет", async () => {
    const [a, b] = await pair();
    payments.failNextCharge = true;
    expect((await send(a.id, b.id)).status).toBe(402);
    expect(await prisma.gift.count({ where: { fromUserId: a.id } })).toBe(0);
  });
});

describe("принять или не принять", () => {
  it("принять: нужен чек-ин в заведении; персоналу уходит только id; код выдачи", async () => {
    const [a, b] = await pair();
    const id = await giftId(await send(a.id, b.id));
    await as(b.id);
    const inbox = (await (await gifts()).json()) as {
      received: { id: string; pickupCode: null }[];
    };
    expect(inbox.received[0]).toMatchObject({ id, pickupCode: null });
    expect(((await (await badges()).json()) as { inbox: number }).inbox).toBe(1);

    await endPresence(redis, b.id);
    expect((await accept(req({ delivery: "pickup" }), ctx(id))).status).toBe(409);
    await here(b.id);
    expect((await accept(req({ delivery: "table" }), ctx(id))).status).toBe(400);
    expect(
      (await accept(req({ delivery: "table", tableNumber: "<script>" }), ctx(id))).status,
    ).toBe(400);

    const bus = await listen(GIFT_CHANNEL);
    expect((await accept(req({ delivery: "table", tableNumber: "12" }), ctx(id))).status).toBe(200);
    await bus.stop();
    expect(bus.events).toEqual([{ type: "accepted", giftId: id }]);
    const g = await prisma.gift.findUniqueOrThrow({ where: { id } });
    expect(g).toMatchObject({ status: "accepted", delivery: "table", tableNumber: "12" });
    expect(g.pickupCode).toMatch(/^\d{4}$/);

    // Повторно не принять; чужой — не принять.
    expect((await accept(req({ delivery: "pickup" }), ctx(id))).status).toBe(404);
    await as(a.id);
    expect((await accept(req({ delivery: "pickup" }), ctx(id))).status).toBe(404);
    const sent = (await (await gifts()).json()) as { sent: { status: string }[] };
    expect(sent.sent[0]?.status).toBe("accepted");
  });

  it("отказ невидим: отправитель не получает событий, видит то же, что при истечении; деньги вернулись", async () => {
    const [a, b] = await pair();
    const c = await mkUser();
    await here(c.id);
    const declined = await giftId(await send(a.id, b.id));
    const expired = await giftId(await send(a.id, c.id));

    await as(b.id);
    const bus = await listen(USER_CHANNEL);
    expect((await decline(req(), ctx(declined))).status).toBe(200);
    await bus.stop();
    expect(bus.events).toEqual([]);

    await prisma.gift.update({ where: { id: expired }, data: { status: "expired" } });
    await as(a.id);
    const { sent } = (await (await gifts()).json()) as {
      sent: { id: string; status: string; refunded: boolean }[];
    };
    // Всё, что видит отправитель, кроме id, имени и факта возврата, — одинаково.
    const view = (id: string) => {
      const g = sent.find((s) => s.id === id)!;
      return { status: g.status, item: (g as unknown as { item: string }).item };
    };
    expect(sent.find((s) => s.id === declined)).toMatchObject({
      status: "not_received",
      refunded: true,
    });
    expect(view(declined)).toEqual(view(expired));
    expect(JSON.stringify(sent)).not.toMatch(/declin|отказ/i);
    const g = await prisma.gift.findUniqueOrThrow({ where: { id: declined } });
    expect(payments.refunds.has(g.paymentId!)).toBe(true);
  });

  it("блокировка отменяет ожидающий подарок с возвратом; бан — тоже", async () => {
    const [a, b] = await pair();
    const id = await giftId(await send(a.id, b.id));
    await as(b.id);
    expect((await block(req(), ctx(a.id))).status).toBe(200);
    const g = await prisma.gift.findUniqueOrThrow({ where: { id } });
    expect(g.status).toBe("declined");
    expect(payments.refunds.has(g.paymentId!)).toBe(true);
    expect(((await (await gifts()).json()) as { received: unknown[] }).received).toEqual([]);

    const [c, d] = await pair();
    const id2 = await giftId(await send(c.id, d.id));
    await banUser(c.id);
    const g2 = await prisma.gift.findUniqueOrThrow({ where: { id: id2 } });
    expect(g2.status).toBe("declined");
    expect(g2.refundedAt).not.toBeNull();
  });
});

describe("отчёт по подаркам", () => {
  it("только модератору; без данных о людях", async () => {
    const [a, b] = await pair();
    await send(a.id, b.id);
    await as(a.id);
    expect((await adminGifts()).status).toBe(404);
    await prisma.user.update({ where: { id: a.id }, data: { role: "admin" } });
    const text = await (await adminGifts()).text();
    expect(text).toContain(TEPLYI.name);
    for (const u of [a, b]) {
      expect(text).not.toContain(u.id);
      expect(text).not.toContain(u.phone);
      expect(text).not.toContain(u.displayName);
    }
  });
});
