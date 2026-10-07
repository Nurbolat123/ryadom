import { StubPaymentProvider } from "@ryadom/billing";
import { createPrismaClient } from "@ryadom/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  cancelGiftsBetween,
  cancelGiftsOf,
  closePendingGift,
  commissionFor,
  expireGifts,
  newPickupCode,
  redeemGift,
  retryRefunds,
} from "../src";

const db = createPrismaClient();
const payments = new StubPaymentProvider();
const deps = { db, payments };
const venue = await db.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const item = await db.menuItem.findFirstOrThrow({
  where: { venueId: venue.id, giftable: true, isAlcohol: false },
});
const users: string[] = [];

const mkUser = async () => {
  const u = await db.user.create({
    data: {
      phone: `+7706${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Тест",
    },
  });
  users.push(u.id);
  return u.id;
};

const mkGift = async (from: string, to: string, expiresInMs = 3600_000) => {
  const paid = await payments.createPayment({
    amount: item.price,
    currency: "KZT",
    description: "test",
    orderId: String(Math.random()),
    returnUrl: "http://x",
  });
  return db.gift.create({
    data: {
      fromUserId: from,
      toUserId: to,
      venueId: venue.id,
      menuItemId: item.id,
      amount: item.price,
      commission: commissionFor(item.price, 12),
      paymentId: paid.paymentId,
      expiresAt: new Date(Date.now() + expiresInMs),
    },
  });
};

afterAll(async () => {
  await db.gift.deleteMany({
    where: { OR: [{ fromUserId: { in: users } }, { toUserId: { in: users } }] },
  });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("подарок: возвраты (правило 8, 9)", () => {
  it("отказ — declined и возврат; повторное закрытие не возвращает деньги второй раз", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const g = await mkGift(a, b);
    expect(await closePendingGift(deps, g.id, "declined")).toBe(true);
    expect(await closePendingGift(deps, g.id, "expired")).toBe(false);
    const after = await db.gift.findUniqueOrThrow({ where: { id: g.id } });
    expect(after).toMatchObject({ status: "declined" });
    expect(after.refundedAt).not.toBeNull();
    expect(after.refundId).toBe(payments.refunds.get(g.paymentId!));
  });

  it("через 2 часа без ответа — expired и возврат; свежие не трогаются", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const old = await mkGift(a, b, -1000);
    const fresh = await mkGift(b, a);
    const closed = await expireGifts(deps);
    expect(closed).toContainEqual({ id: old.id, fromUserId: a, toUserId: b });
    expect((await db.gift.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("expired");
    expect(payments.refunds.has(old.paymentId!)).toBe(true);
    expect((await db.gift.findUniqueOrThrow({ where: { id: fresh.id } })).status).toBe("pending");
  });

  it("принятый подарок не истекает и не возвращается", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const g = await mkGift(a, b, -1000);
    await db.gift.update({
      where: { id: g.id },
      data: { status: "accepted", delivery: "pickup", pickupCode: "1234" },
    });
    await expireGifts(deps);
    expect((await db.gift.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("accepted");
    expect(payments.refunds.has(g.paymentId!)).toBe(false);
  });

  it("возврат не прошёл — повторяется позже", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const g = await mkGift(a, b);
    payments.failNextRefund = true;
    await closePendingGift(deps, g.id, "declined", new Date(Date.now() - 120_000));
    expect((await db.gift.findUniqueOrThrow({ where: { id: g.id } })).refundedAt).toBeNull();
    expect(await retryRefunds(deps)).toBeGreaterThanOrEqual(1);
    expect((await db.gift.findUniqueOrThrow({ where: { id: g.id } })).refundedAt).not.toBeNull();
  });

  it("блокировка отменяет ожидающие подарки в обе стороны, бан — все подарки человека", async () => {
    const [a, b, c] = [await mkUser(), await mkUser(), await mkUser()];
    const ab = await mkGift(a, b);
    const ba = await mkGift(b, a);
    const ca = await mkGift(c, a);
    expect(await cancelGiftsBetween(deps, a, b)).toHaveLength(2);
    for (const g of [ab, ba]) {
      const x = await db.gift.findUniqueOrThrow({ where: { id: g.id } });
      expect(x.status).toBe("declined");
      expect(x.refundedAt).not.toBeNull();
    }
    expect((await db.gift.findUniqueOrThrow({ where: { id: ca.id } })).status).toBe("pending");
    expect(await cancelGiftsOf(deps, c)).toHaveLength(1);
    expect((await db.gift.findUniqueOrThrow({ where: { id: ca.id } })).refundedAt).not.toBeNull();
  });
});

describe("выдача в Telegram", () => {
  it("«Выдано» — только из чата этого заведения и только для принятого подарка", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const g = await mkGift(a, b);
    const chat = `-100${Math.floor(Math.random() * 1e9)}`;
    await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: chat } });
    try {
      expect(await redeemGift(db, g.id, chat)).toEqual({ ok: false, error: "not_accepted" });
      await db.gift.update({
        where: { id: g.id },
        data: { status: "accepted", delivery: "pickup", pickupCode: newPickupCode() },
      });
      expect(await redeemGift(db, g.id, "-100999")).toEqual({ ok: false, error: "wrong_venue" });
      const res = await redeemGift(db, g.id, chat);
      expect(res.ok).toBe(true);
      expect((await db.gift.findUniqueOrThrow({ where: { id: g.id } })).status).toBe("redeemed");
      expect(await redeemGift(db, g.id, chat)).toEqual({ ok: false, error: "not_accepted" });
    } finally {
      await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: null } });
    }
  });
});

describe("ограничения базы", () => {
  it("алкоголь нельзя сделать giftable (CHECK)", async () => {
    const alcohol = await db.menuItem.findFirstOrThrow({ where: { isAlcohol: true } });
    await expect(
      db.menuItem.update({ where: { id: alcohol.id }, data: { giftable: true } }),
    ).rejects.toThrow();
  });

  it("принятый подарок без способа получения и столик без номера — запрещены (CHECK)", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const g = await mkGift(a, b);
    await expect(
      db.gift.update({ where: { id: g.id }, data: { status: "accepted" } }),
    ).rejects.toThrow();
    await expect(
      db.gift.update({
        where: { id: g.id },
        data: { status: "accepted", delivery: "table", pickupCode: "1234" },
      }),
    ).rejects.toThrow();
  });

  it("код выдачи — 4 цифры, комиссия округляется", () => {
    for (let i = 0; i < 50; i++) expect(newPickupCode()).toMatch(/^\d{4}$/);
    expect(commissionFor(120_000, 12)).toBe(14_400);
    expect(commissionFor(99, 12)).toBe(12);
  });
});
