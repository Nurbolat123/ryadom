import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar, requestHeaders } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { setPaymentProvider, StubPaymentProvider } = await import("@ryadom/billing");
const { endPresence, getPresence, setOpenToMeet, startPresence } = await import("@ryadom/presence");
const { GET: me, PATCH: patchMe, DELETE: deleteMe } = await import("@/app/api/me/route");
const { POST: gift } = await import("@/app/api/people/[id]/gift/route");
const { POST: setLocale } = await import("@/app/api/locale/route");
const { POST: requestCode } = await import("@/app/api/auth/code/route");
const { redis } = await import("@/lib/redis");
const { getSession, startSession } = await import("@/lib/server/session");
const { setPhotoStorage } = await import("@/lib/server/storage");
const { setSmsProvider } = await import("@/lib/server/sms");

const payments = new StubPaymentProvider("instant");
setPaymentProvider(payments);
const deletedPhotos: string[] = [];
setPhotoStorage({
  put: async () => undefined,
  get: async () => null,
  delete: async (key) => void deletedPhotos.push(key),
});
const smsTexts: string[] = [];
setSmsProvider({ sendCode: async (_phone, _code, text) => void smsTexts.push(text) });

const TEPLYI = await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const coffee = await prisma.menuItem.findFirstOrThrow({
  where: { venueId: TEPLYI.id, giftable: true, isAlcohol: false, isAvailable: true },
});

const users: string[] = [];
const mkUser = async (name = "Тест") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7706${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: name,
      photo: `u/${Math.random().toString(36).slice(2)}/photo.webp`,
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
const here = async (userId: string) => {
  const visit = await prisma.visit.create({ data: { userId, venueId: TEPLYI.id } });
  await startPresence(redis, userId, TEPLYI.id, visit.id);
  await setOpenToMeet(redis, userId, true);
};
const req = (method: string, body?: unknown) =>
  new Request("http://x", {
    method,
    headers: { "x-forwarded-for": "10.12.0.1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  jar.clear();
  for (const k of [...requestHeaders.keys()]) requestHeaders.delete(k);
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  setPhotoStorage(null);
  setSmsProvider(null);
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("профиль", () => {
  it("правка имени и «о себе»; предложения по интересам выключены по умолчанию", async () => {
    const u = await mkUser();
    await as(u.id);
    const before = (await (await me()).json()) as { user: { adsConsent: boolean } };
    expect(before.user.adsConsent).toBe(false);

    const ok = await patchMe(req("PATCH", { displayName: "Айгерім", about: "Люблю кофе и книги" }));
    expect(ok.status).toBe(200);
    const saved = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(saved.displayName).toBe("Айгерім");
    expect(saved.about).toBe("Люблю кофе и книги");
    expect(saved.adsConsent).toBe(false);

    expect((await patchMe(req("PATCH", { about: "x".repeat(121) }))).status).toBe(400);
    expect((await patchMe(req("PATCH", { displayName: "1" }))).status).toBe(400);
    // Телефон, роль и подтверждение селфи через профиль не меняются.
    expect((await patchMe(req("PATCH", { phone: "+77010000000" }))).status).toBe(400);
    expect((await patchMe(req("PATCH", { role: "admin" }))).status).toBe(400);

    expect((await patchMe(req("PATCH", { adsConsent: true }))).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).adsConsent).toBe(true);
    await patchMe(req("PATCH", { about: "" }));
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).about).toBeNull();

    jar.clear();
    expect((await patchMe(req("PATCH", { about: "a" }))).status).toBe(401);
  });

  it("смена языка запоминается в профиле — по нему приходят уведомления", async () => {
    const u = await mkUser();
    await as(u.id);
    expect((await setLocale(req("POST", { locale: "kk" }))).status).toBe(200);
    expect(jar.get("locale")).toBe("kk");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).locale).toBe("kk");
    expect((await setLocale(req("POST", { locale: "en" }))).status).toBe(400);
  });

  it("SMS с кодом — на языке браузера, если язык ещё не выбран", async () => {
    requestHeaders.set("accept-language", "kk-KZ,kk;q=0.9,ru;q=0.8");
    const phone = `+7706${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
    expect((await requestCode(req("POST", { phone }))).status).toBe(200);
    expect(smsTexts.at(-1)).toMatch(/^рядом: кіру коды \d{6}/);
  });
});

describe("удаление аккаунта", () => {
  it("нужно явное подтверждение", async () => {
    const u = await mkUser();
    await as(u.id);
    expect((await deleteMe(req("DELETE", {}))).status).toBe(400);
    expect((await deleteMe(req("DELETE", { confirm: "yes" }))).status).toBe(400);
    expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
  });

  it("удаляет всё сразу: профиль, фото, отметку, приветы; подарки возвращаются", async () => {
    const [a, b] = [await mkUser("Даурен"), await mkUser("Алия")];
    await here(a.id);
    await here(b.id);
    await as(a.id);
    const sent = await gift(req("POST", { menuItemId: coffee.id }), {
      params: Promise.resolve({ id: b.id }),
    });
    expect(sent.status).toBe(201);
    const g = await prisma.gift.findFirstOrThrow({ where: { fromUserId: a.id, toUserId: b.id } });
    await prisma.hello.create({
      data: { fromUserId: b.id, toUserId: a.id, venueId: TEPLYI.id, message: "Привет!" },
    });
    await prisma.userInterest.create({
      data: { userId: a.id, interestId: (await prisma.interest.findFirstOrThrow()).id },
    });

    await as(a.id);
    const res = await deleteMe(req("DELETE", { confirm: true }));
    expect(res.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: a.id } })).toBeNull();
    expect(await getSession()).toBeNull();
    expect(await prisma.session.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.userInterest.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.visit.count({ where: { userId: a.id } })).toBe(0);
    expect(await prisma.hello.count({ where: { toUserId: a.id } })).toBe(0);
    expect(await getPresence(redis, a.id)).toBeNull();
    expect(deletedPhotos).toContain(a.photo);

    // Подарок закрыт, деньги вернулись, отправитель в записи больше не указан.
    const closed = await prisma.gift.findUniqueOrThrow({ where: { id: g.id } });
    expect(closed.status).toBe("declined");
    expect(closed.fromUserId).toBeNull();
    expect(payments.refunds.has(closed.paymentId!)).toBe(true);
    // Оплата осталась для бухгалтерии — без ссылки на человека.
    const purchase = await prisma.purchase.findFirst({ where: { paymentId: closed.paymentId } });
    expect(purchase?.userId ?? null).toBeNull();

    // Второй человек на месте, его визит не тронут.
    expect(await prisma.user.findUnique({ where: { id: b.id } })).not.toBeNull();
    expect(await getPresence(redis, b.id)).not.toBeNull();
  });
});
