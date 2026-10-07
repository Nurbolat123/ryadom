import { createPrismaClient, type ProductCode } from "@ryadom/db";
import { afterAll, describe, expect, it } from "vitest";
import {
  cancelAutoRenew,
  expireStalePurchases,
  markFailed,
  markPaid,
  processRenewals,
  StubPaymentProvider,
  type PaymentProvider,
} from "../src";

const db = createPrismaClient();
const users: string[] = [];
const HOUR = 3600_000;

const mkUser = async () => {
  const u = await db.user.create({
    data: {
      phone: `+7707${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "male",
      displayName: "Тест",
    },
  });
  users.push(u.id);
  return u.id;
};

/** Заказ в ожидании оплаты, как его создаёт веб. */
const order = async (userId: string, product: ProductCode, autoRenew = false, createdAt?: Date) => {
  const paymentId = `test_${Math.random()}`;
  await db.purchase.create({
    data: { userId, product, autoRenew, amount: 99000, currency: "KZT", paymentId, createdAt },
  });
  return paymentId;
};

const entitlement = (userId: string) => db.entitlement.findUniqueOrThrow({ where: { userId } });

afterAll(async () => {
  await db.notice.deleteMany({ where: { userId: { in: users } } });
  await db.purchase.deleteMany({ where: { userId: { in: users } } });
  await db.user.deleteMany({ where: { id: { in: users } } });
  await db.$disconnect();
});

describe("начисление после оплаты", () => {
  it("«Плюс» начисляется один раз, даже если подтверждение пришло дважды", async () => {
    const u = await mkUser();
    const now = new Date();
    const pay = await order(u, "plus_week");
    expect(await markPaid(db, pay, now)).not.toBeNull();
    expect(await markPaid(db, pay, now)).toBeNull();
    const e = await entitlement(u);
    expect(e.plusUntil!.getTime() - now.getTime()).toBe(7 * 24 * HOUR);
    // 1 бесплатный суперпривет при регистрации остаётся.
    expect(e.superHellos).toBe(1);
  });

  it("новый пропуск продлевает от конца текущего, а не от сейчас", async () => {
    const u = await mkUser();
    const now = new Date();
    await markPaid(db, await order(u, "plus_evening"), now);
    await markPaid(db, await order(u, "plus_month"), now);
    const e = await entitlement(u);
    expect(e.plusUntil!.getTime() - now.getTime()).toBe((24 + 30 * 24) * HOUR);
    expect(e.autoRenew).toBe(false);
  });

  it("пакет суперприветов прибавляется к остатку", async () => {
    const u = await mkUser();
    await markPaid(db, await order(u, "super_hello_5"));
    await markPaid(db, await order(u, "super_hello_1"));
    expect((await entitlement(u)).superHellos).toBe(1 + 5 + 1);
  });

  it("автопродление — только если человек сам поставил галочку", async () => {
    const u = await mkUser();
    await markPaid(db, await order(u, "plus_month", true));
    expect(await entitlement(u)).toMatchObject({ autoRenew: true, autoRenewProduct: "plus_month" });
    await cancelAutoRenew(db, u);
    expect(await entitlement(u)).toMatchObject({ autoRenew: false, autoRenewProduct: null });
  });

  it("автопродление недельного пропуска база не примет", async () => {
    const u = await mkUser();
    await expect(order(u, "plus_week", true)).rejects.toThrow();
  });

  it("неудачная оплата ничего не начисляет и не становится оплаченной", async () => {
    const u = await mkUser();
    const pay = await order(u, "plus_week");
    expect(await markFailed(db, pay)).toBe(true);
    expect(await markPaid(db, pay)).toBeNull();
    expect(await db.entitlement.findUnique({ where: { userId: u } })).toBeNull();
  });

  it("неоплаченные заказы старше 30 минут закрываются", async () => {
    const u = await mkUser();
    const old = await order(u, "plus_week", false, new Date(Date.now() - 31 * 60_000));
    const fresh = await order(u, "plus_week");
    await expireStalePurchases(db);
    const rows = await db.purchase.findMany({ where: { userId: u } });
    expect(rows.find((p) => p.paymentId === old)?.status).toBe("failed");
    expect(rows.find((p) => p.paymentId === fresh)?.status).toBe("pending");
  });
});

describe("продление «Плюс»", () => {
  /** «Плюс» на месяц с автопродлением, который заканчивается через `leftMs`. */
  const subscriber = async (leftMs: number) => {
    const u = await mkUser();
    await markPaid(db, await order(u, "plus_month", true));
    await db.entitlement.update({
      where: { userId: u },
      data: { plusUntil: new Date(Date.now() + leftMs) },
    });
    return u;
  };
  const run = async (payments: PaymentProvider) => {
    const notified: string[] = [];
    await processRenewals({ db, payments, notify: (id) => notified.push(id) });
    return notified;
  };
  const kinds = async (u: string) =>
    (await db.notice.findMany({ where: { userId: u }, orderBy: { createdAt: "asc" } })).map(
      (n) => n.kind,
    );

  it("напоминание за 2 дня, один раз", async () => {
    const u = await subscriber(47 * HOUR);
    const far = await subscriber(72 * HOUR);
    const payments = new StubPaymentProvider();
    expect(await run(payments)).toContain(u);
    await run(payments);
    expect(await kinds(u)).toEqual(["plus_renewal_reminder"]);
    expect(await kinds(far)).toEqual([]);
  });

  it("срок вышел — списание и продление на месяц", async () => {
    const u = await subscriber(-1000);
    const before = (await entitlement(u)).plusUntil!;
    const payments = new StubPaymentProvider();
    expect(await run(payments)).toContain(u);
    const e = await entitlement(u);
    expect(e.autoRenew).toBe(true);
    expect(e.plusUntil!.getTime()).toBeGreaterThan(before.getTime() + 29 * 24 * HOUR);
    expect(await kinds(u)).toEqual(["plus_renewed"]);
    const renewal = await db.purchase.findFirstOrThrow({ where: { userId: u, isRenewal: true } });
    expect(renewal.status).toBe("paid");
  });

  it("списание не прошло — автопродление выключается, «Плюс» заканчивается", async () => {
    const u = await subscriber(-1000);
    const payments = new StubPaymentProvider();
    payments.failNextPayment = true;
    await run(payments);
    const e = await entitlement(u);
    expect(e.autoRenew).toBe(false);
    expect(e.plusUntil!.getTime()).toBeLessThan(Date.now());
    expect(await kinds(u)).toEqual(["plus_renewal_failed"]);
    expect(
      (await db.purchase.findFirstOrThrow({ where: { userId: u, isRenewal: true } })).status,
    ).toBe("failed");
  });

  it("провайдер без повторных списаний (Kaspi) — ничего не списывается", async () => {
    const u = await subscriber(-1000);
    const payments: PaymentProvider = {
      name: "norecurring",
      supportsRecurring: false,
      createPayment: () => Promise.reject(new Error("no")),
      getStatus: async () => "pending",
      refund: () => Promise.reject(new Error("no")),
      parseWebhook: async () => null,
    };
    await run(payments);
    expect((await entitlement(u)).autoRenew).toBe(false);
    expect(await kinds(u)).toEqual(["plus_renewal_failed"]);
    expect(await db.purchase.count({ where: { userId: u, isRenewal: true } })).toBe(0);
  });

  it("отменённое продление не списывается", async () => {
    const u = await subscriber(-1000);
    await cancelAutoRenew(db, u);
    await run(new StubPaymentProvider());
    expect(await kinds(u)).toEqual([]);
    expect(await db.purchase.count({ where: { userId: u, isRenewal: true } })).toBe(0);
  });
});
