import { createPrismaClient } from "@ryadom/db";
import { USER_CHANNEL } from "@ryadom/presence";
import { Redis } from "ioredis";
import { afterAll, describe, expect, it } from "vitest";
import { createLinkCode, createOrders } from "../src/orders";

const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
// Отдельное заведение, чтобы не мешать другим тестам с привязкой чата.
const venue = await db.venue.findUniqueOrThrow({ where: { slug: "sad-na-panfilova" } });
const item = await db.menuItem.findFirstOrThrow({ where: { venueId: venue.id, giftable: true } });
const users: { id: string; phone: string; displayName: string }[] = [];
const sent: { chatId: string; text: string; buttons: unknown }[] = [];
const orders = createOrders({
  db,
  redis,
  api: { sendMessage: async (chatId, text, buttons) => void sent.push({ chatId, text, buttons }) },
});

const mkUser = async (name: string) => {
  const u = await db.user.create({
    data: {
      phone: `+7704${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: name,
    },
  });
  users.push(u);
  return u;
};
const acceptedGift = async (delivery: "pickup" | "table") => {
  const [a, b] = [await mkUser("Ерлан"), await mkUser("Жанар")];
  return db.gift.create({
    data: {
      fromUserId: a.id,
      toUserId: b.id,
      venueId: venue.id,
      menuItemId: item.id,
      amount: item.price,
      commission: 0,
      note: "секретная записка",
      status: "accepted",
      delivery,
      pickupCode: "4821",
      tableNumber: delivery === "table" ? "7" : null,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
};

afterAll(async () => {
  await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: null } });
  await db.gift.deleteMany({ where: { fromUserId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
  redis.disconnect();
});

describe("бот заведения", () => {
  it("без привязанного чата заказ ждёт; после /link КОД — досылается, один раз", async () => {
    await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: null } });
    const g = await acceptedGift("pickup");
    expect(await orders.announce(g.id)).toBe(false);
    expect(sent).toHaveLength(0);

    expect(await orders.link("WRONG1", "-1001")).toBeNull();
    const code = await createLinkCode(redis, venue.id);
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(await orders.link(code.toLowerCase(), "-1001")).toBe(venue.name);
    expect(await orders.link(code, "-1002")).toBeNull(); // одноразовый
    expect(sent.filter((m) => m.text.includes("4821"))).toHaveLength(1);
    expect(await orders.announce(g.id)).toBe(false);
    expect(await orders.announcePending()).toBe(0);
  });

  it("в заказе только позиция, код и столик — без имён, телефонов и записки", async () => {
    sent.length = 0;
    const g = await acceptedGift("table");
    expect(await orders.announce(g.id)).toBe(true);
    const [msg] = sent;
    expect(msg?.chatId).toBe("-1001");
    expect(msg?.text).toContain(item.name);
    expect(msg?.text).toContain("4821");
    expect(msg?.text).toContain("столик 7");
    for (const u of users) {
      expect(msg?.text).not.toContain(u.displayName);
      expect(msg?.text).not.toContain(u.phone);
      expect(msg?.text).not.toContain(u.id);
    }
    expect(msg?.text).not.toContain("секретная");
    expect(msg?.buttons).toEqual([{ text: "Выдано", callback_data: `redeem:${g.id}` }]);
  });

  it("«Выдано»: чужой чат — нет; свой — redeemed и обоим обновить входящие", async () => {
    const g = await acceptedGift("pickup");
    expect((await orders.onButton(`redeem:${g.id}`, "-999")).ok).toBe(false);
    const sub = redis.duplicate();
    const events: unknown[] = [];
    await sub.subscribe(USER_CHANNEL);
    sub.on("message", (_c, m) => events.push(JSON.parse(m)));
    expect((await orders.onButton(`redeem:${g.id}`, "-1001")).ok).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    sub.disconnect();
    expect((await db.gift.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("redeemed");
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "inbox", userId: g.toUserId },
        { type: "inbox", userId: g.fromUserId },
      ]),
    );
    expect((await orders.onButton(`redeem:${g.id}`, "-1001")).ok).toBe(false);
  });
});
