import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { KaspiPayProvider, setPaymentProvider, StubPaymentProvider } =
  await import("@ryadom/billing");
const { endPresence, setOpenToMeet, startPresence } = await import("@ryadom/presence");
const { GET: plusGet } = await import("@/app/api/plus/route");
const { POST: purchase } = await import("@/app/api/plus/purchase/route");
const { DELETE: stopRenew } = await import("@/app/api/plus/auto-renew/route");
const { POST: boost } = await import("@/app/api/here/boost/route");
const { GET: purchaseGet } = await import("@/app/api/purchases/[id]/route");
const { POST: stubPay } = await import("@/app/api/payments/stub/[paymentId]/route");
const { POST: webhook } = await import("@/app/api/payments/webhook/[provider]/route");
const { POST: hello } = await import("@/app/api/people/[id]/hello/route");
const { POST: gift } = await import("@/app/api/people/[id]/gift/route");
const { GET: people } = await import("@/app/api/here/people/route");
const { POST: block } = await import("@/app/api/people/[id]/block/route");
const { GET: giftMenu } = await import("@/app/api/here/menu/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");

const stub = new StubPaymentProvider("redirect");
setPaymentProvider(stub);

const TEPLYI = await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const coffee = await prisma.menuItem.findFirstOrThrow({
  where: { venueId: TEPLYI.id, giftable: true, isAlcohol: false, isAvailable: true },
});

const users: string[] = [];
const mkUser = async (name = "Тест") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7704${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "male",
      displayName: name,
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
    },
  });
  users.push(u.id);
  return u.id;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const here = async (userId: string) => {
  const visit = await prisma.visit.create({ data: { userId, venueId: TEPLYI.id } });
  await startPresence(redis, userId, TEPLYI.id, visit.id);
  await setOpenToMeet(redis, userId, true);
  return visit.id;
};
const givePlus = (userId: string, hours = 24) =>
  prisma.entitlement.upsert({
    where: { userId },
    create: { userId, superHellos: 0, plusUntil: new Date(Date.now() + hours * 3600_000) },
    update: { plusUntil: new Date(Date.now() + hours * 3600_000) },
  });
const post = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <K extends string>(key: K, value: string) =>
  ({ params: Promise.resolve({ [key]: value }) }) as { params: Promise<Record<K, string>> };
const json = async <T = Record<string, unknown>>(res: Response) => (await res.json()) as T;

const buy = async (userId: string, product: string, autoRenew?: boolean) => {
  await as(userId);
  return purchase(post({ product, autoRenew }));
};
const sayHello = async (from: string, to: string, isSuper = false) => {
  await as(from);
  return hello(post({ isSuper, message: "Привет!" }), ctx("id", to));
};

beforeEach(async () => {
  jar.clear();
  setPaymentProvider(stub);
  for (const id of users) await endPresence(redis, id);
  for (const k of await redis.keys("rl:*")) await redis.del(k);
});
afterAll(async () => {
  for (const id of users) {
    await endPresence(redis, id);
    await redis.del(`boost:${id}`);
  }
  await prisma.gift.deleteMany({ where: { fromUserId: { in: users } } });
  await prisma.purchase.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("покупка «Плюс»", () => {
  it("заказ → страница оплаты → «Оплатить» → «Плюс» начислен", async () => {
    const u = await mkUser();
    const res = await buy(u, "plus_week");
    expect(res.status).toBe(202);
    const { redirectUrl, purchaseId } = await json<{ redirectUrl: string; purchaseId: string }>(
      res,
    );
    const paymentId = redirectUrl.split("/pay/stub/")[1]!.split("?")[0]!;
    // До оплаты ничего не начислено.
    expect((await json<{ plus: { active: boolean } }>(await plusGet())).plus.active).toBe(false);
    expect((await json(await purchaseGet(post(), ctx("id", purchaseId)))).status).toBe("pending");

    // Чужой заказ оплатить нельзя.
    await as(await mkUser());
    expect((await stubPay(post({ action: "pay" }), ctx("paymentId", paymentId))).status).toBe(404);
    expect((await purchaseGet(post(), ctx("id", purchaseId))).status).toBe(404);

    await as(u);
    expect((await stubPay(post({ action: "pay" }), ctx("paymentId", paymentId))).status).toBe(200);
    expect(await json(await purchaseGet(post(), ctx("id", purchaseId)))).toMatchObject({
      status: "paid",
      kind: "plus",
    });
    const state = await json<{ plus: { active: boolean; autoRenew: boolean } }>(await plusGet());
    expect(state.plus).toMatchObject({ active: true, autoRenew: false });
    // Повторное подтверждение ничего не добавляет.
    const until = (await prisma.entitlement.findUniqueOrThrow({ where: { userId: u } })).plusUntil;
    await stubPay(post({ action: "pay" }), ctx("paymentId", paymentId));
    expect(
      (await prisma.entitlement.findUniqueOrThrow({ where: { userId: u } })).plusUntil,
    ).toEqual(until);
  });

  it("«Отменить» на странице оплаты — ничего не начислено", async () => {
    const u = await mkUser();
    const { redirectUrl, purchaseId } = await json<{ redirectUrl: string; purchaseId: string }>(
      await buy(u, "super_hello_5"),
    );
    const paymentId = redirectUrl.split("/pay/stub/")[1]!.split("?")[0]!;
    await stubPay(post({ action: "cancel" }), ctx("paymentId", paymentId));
    expect((await json(await purchaseGet(post(), ctx("id", purchaseId)))).status).toBe("failed");
    const state = await json<{ superHellos: { total: number } }>(await plusGet());
    expect(state.superHellos.total).toBe(1); // только бесплатный при регистрации
  });

  it("цены — из таблицы Price для страны пользователя", async () => {
    await as(await mkUser());
    const { products } = await json<{ products: { product: string; amount: number }[] }>(
      await plusGet(),
    );
    expect(products.map((p) => [p.product, p.amount / 100])).toEqual([
      ["plus_evening", 490],
      ["plus_week", 990],
      ["plus_month", 1990],
      ["plus_3months", 4490],
      ["super_hello_1", 290],
      ["super_hello_5", 990],
    ]);
  });

  it("автопродление: только месячные, только у провайдера с повторными списаниями; отмена в одно нажатие", async () => {
    const u = await mkUser();
    expect((await buy(u, "plus_week", true)).status).toBe(400);
    expect((await buy(u, "super_hello_1", true)).status).toBe(400);

    setPaymentProvider(new StubPaymentProvider("instant"));
    expect((await buy(u, "plus_month", true)).status).toBe(201);
    let state = await json<{ plus: { autoRenew: boolean } }>(await plusGet());
    expect(state.plus.autoRenew).toBe(true);
    expect((await stopRenew()).status).toBe(200);
    state = await json(await plusGet());
    expect(state.plus.autoRenew).toBe(false);

    // Kaspi не умеет списывать без человека — автопродление не предлагается.
    setPaymentProvider(
      new KaspiPayProvider({
        apiUrl: "https://k",
        merchantId: "m",
        apiKey: "k",
        webhookSecret: "s",
      }),
    );
    expect((await json<{ canAutoRenew: boolean }>(await plusGet())).canAutoRenew).toBe(false);
    const res = await buy(u, "plus_month", true);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("auto_renew_unavailable");
  });
});

describe("уведомление провайдера (webhook)", () => {
  const secret = "test-secret";
  const kaspiPaid = new KaspiPayProvider({
    apiUrl: "https://k",
    merchantId: "m",
    apiKey: "k",
    webhookSecret: secret,
    fetch: (async () =>
      new Response(JSON.stringify({ paymentId: `k_${Math.random()}`, paymentUrl: "https://pay" }), {
        status: 200,
      })) as unknown as typeof fetch,
  });
  const hook = (body: string, signature: string) =>
    webhook(
      new Request("http://x", { method: "POST", body, headers: { "x-signature": signature } }),
      ctx("provider", "kaspi"),
    );

  it("неверная подпись — 401 и ничего не меняется; верная — начисление", async () => {
    setPaymentProvider(kaspiPaid);
    const u = await mkUser();
    const res = await buy(u, "plus_evening");
    expect(res.status).toBe(202);
    const { purchaseId } = await json<{ purchaseId: string }>(res);
    const p = await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } });
    const body = JSON.stringify({ paymentId: p.paymentId, status: "PAID" });

    expect((await hook(body, "bad")).status).toBe(401);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } })).status).toBe(
      "pending",
    );
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect((await hook(body, sig)).status).toBe(200);
    expect((await hook(body, sig)).status).toBe(200);
    expect((await prisma.purchase.findUniqueOrThrow({ where: { id: purchaseId } })).status).toBe(
      "paid",
    );
    const e = await prisma.entitlement.findUniqueOrThrow({ where: { userId: u } });
    expect(e.plusUntil!.getTime() - Date.now()).toBeLessThanOrEqual(24 * 3600_000);
    expect(e.plusUntil!.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000);
  });

  it("в Kaspi уходят только сумма, номер заказа и обезличенное описание", async () => {
    const sent: unknown[] = [];
    setPaymentProvider(
      new KaspiPayProvider({
        apiUrl: "https://k",
        merchantId: "m",
        apiKey: "k",
        webhookSecret: secret,
        fetch: (async (_u: string, init: RequestInit) => {
          sent.push(JSON.parse(String(init.body)));
          return new Response(JSON.stringify({ paymentId: "k1x", paymentUrl: "https://pay" }));
        }) as unknown as typeof fetch,
      }),
    );
    const [a, b] = [await mkUser("Даурен"), await mkUser("Алия")];
    await here(a);
    await here(b);
    await as(a);
    expect(
      (await gift(post({ menuItemId: coffee.id, note: "Секретная записка" }), ctx("id", b))).status,
    ).toBe(202);
    const text = JSON.stringify(sent);
    expect(Object.keys(sent[0] as object).sort()).toEqual(
      ["amount", "currency", "description", "merchantId", "orderId", "returnUrl"].sort(),
    );
    for (const leak of ["Даурен", "Алия", "Секретная", "+770", a, b])
      expect(text).not.toContain(leak);
    await prisma.purchase.deleteMany({ where: { paymentId: "k1x" } });
  });
});

describe("правило 11: «Плюс» не обходит согласие", () => {
  it("больше приветов в день, но второй привет тому же человеку — нельзя", async () => {
    const a = await mkUser();
    await givePlus(a);
    await here(a);
    for (let i = 0; i < 6; i++) {
      const b = await mkUser();
      await here(b);
      expect((await sayHello(a, b)).status).toBe(201);
    }
    const last = users[users.length - 1]!;
    expect((await sayHello(a, last)).status).toBe(409);
    expect((await sayHello(a, last, true)).status).toBe(409);
  });

  it("без «Плюс» — 5 приветов в день", async () => {
    const a = await mkUser();
    await here(a);
    for (let i = 0; i < 5; i++) {
      const b = await mkUser();
      await here(b);
      expect((await sayHello(a, b)).status).toBe(201);
    }
    const b = await mkUser();
    await here(b);
    const res = await sayHello(a, b);
    expect(res.status).toBe(429);
    expect((await json(res)).error).toBe("hello_limit");
  });

  it("2 недельных суперпривета с «Плюс», потом купленные", async () => {
    const a = await mkUser();
    await givePlus(a);
    await here(a);
    await as(a);
    expect(
      (await json<{ superHellos: { total: number; weekly: number } }>(await plusGet())).superHellos,
    ).toMatchObject({ total: 2, weekly: 2 });
    for (let i = 0; i < 2; i++) {
      const b = await mkUser();
      await here(b);
      expect((await sayHello(a, b, true)).status).toBe(201);
    }
    await as(a);
    expect(
      (await json<{ superHellos: { weekly: number } }>(await plusGet())).superHellos.weekly,
    ).toBe(0);
    // Недельные кончились — третий только за купленные, а их 0.
    const b = await mkUser();
    await here(b);
    const res = await sayHello(a, b, true);
    expect((await json(res)).error).toBe("no_super_hellos");
  });
});

describe("буст видимости", () => {
  it("только с «Плюс», только открытым, раз за визит; поднимает выше в списке", async () => {
    const [viewer, a, b] = [await mkUser(), await mkUser(), await mkUser()];
    for (const u of [viewer, a, b]) await here(u);

    await as(b);
    expect((await boost()).status).toBe(402); // без «Плюс»
    await givePlus(b);
    await setOpenToMeet(redis, b, false);
    expect((await boost()).status).toBe(403); // не открыт(а)
    await setOpenToMeet(redis, b, true);
    expect((await boost()).status).toBe(200);
    expect((await boost()).status).toBe(409); // второй раз за визит

    await as(viewer);
    const list = await json<{ people: Record<string, unknown>[] }>(await people());
    const ids = list.people.map((p) => p.id);
    expect(ids.indexOf(b)).toBe(0);
    expect(ids).toContain(a);
    // Признак буста другим не показывается.
    expect(JSON.stringify(list)).not.toMatch(/boost/i);

    // Новый визит — снова можно.
    await as(b);
    await here(b);
    await redis.del(`boost:${b}`);
    expect((await boost()).status).toBe(200);
  });
});

describe("подарок через страницу оплаты", () => {
  const pay = async (from: string, to: string) => {
    await as(from);
    const res = await gift(post({ menuItemId: coffee.id }), ctx("id", to));
    expect(res.status).toBe(202);
    const { redirectUrl } = await json<{ redirectUrl: string }>(res);
    return redirectUrl.split("/pay/stub/")[1]!.split("?")[0]!;
  };

  it("подарок появляется только после оплаты", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    const paymentId = await pay(a, b);
    expect(await prisma.gift.count({ where: { fromUserId: a } })).toBe(0);
    // Пока заказ ждёт оплаты, второй подарок тому же человеку не начать.
    await as(a);
    expect((await gift(post({ menuItemId: coffee.id }), ctx("id", b))).status).toBe(409);

    expect((await stubPay(post({ action: "pay" }), ctx("paymentId", paymentId))).status).toBe(200);
    const g = await prisma.gift.findFirstOrThrow({ where: { fromUserId: a } });
    expect(g).toMatchObject({ toUserId: b, status: "pending", paymentId });
  });

  it("заблокировали, пока платил, — подарка нет, деньги возвращаются", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    const paymentId = await pay(a, b);
    await as(b);
    expect((await block(post(), ctx("id", a))).status).toBe(200);
    await as(a);
    const { purchaseId } = await json<{ purchaseId: string }>(
      await stubPay(post({ action: "pay" }), ctx("paymentId", paymentId)),
    );
    expect(await prisma.gift.count({ where: { fromUserId: a } })).toBe(0);
    expect(stub.refunds.has(paymentId)).toBe(true);
    expect((await json(await purchaseGet(post(), ctx("id", purchaseId)))).status).toBe("refunded");
  });
});

describe("оплата выключена (PAYMENT_PROVIDER=none)", () => {
  const saved = process.env.PAYMENT_PROVIDER;
  beforeEach(() => {
    process.env.PAYMENT_PROVIDER = "none";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = saved;
  });

  it("«Плюс», меню «Угостить» и подарок недоступны, заказов не создаётся", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    const res = await buy(a, "plus_week");
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: "payments_disabled" });
    await as(a);
    expect((await giftMenu()).status).toBe(403);
    expect((await gift(post({ menuItemId: coffee.id }), ctx("id", b))).status).toBe(403);
    expect(await prisma.purchase.count({ where: { userId: a } })).toBe(0);
  });

  it("бесплатное работает: привет и список людей", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    expect((await sayHello(a, b)).status).toBe(201);
    await as(a);
    expect((await people()).status).toBe(200);
  });
});
