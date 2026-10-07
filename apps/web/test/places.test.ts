import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { endPresence, setOpenToMeet, startPresence } = await import("@ryadom/presence");
const { snapshotActivity, ACTIVITY_KEY } = await import("@ryadom/places");
const { POST: places } = await import("@/app/api/places/route");
const { GET: place } = await import("@/app/api/places/[slug]/route");
const { GET: top } = await import("@/app/api/places/top/route");
const { POST: offerCode } = await import("@/app/api/offers/[id]/code/route");
const { POST: offerClick } = await import("@/app/api/offers/[id]/click/route");
const { POST: appOpen } = await import("@/app/api/analytics/open/route");
const { GET: adminOffers, POST: adminCreate } = await import("@/app/api/admin/offers/route");
const { POST: adminModerate } = await import("@/app/api/admin/offers/[id]/route");
const { GET: adminPartners } = await import("@/app/api/admin/partners/route");
const { GET: adminFunnel } = await import("@/app/api/admin/funnel/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");

const TEPLYI = await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const POLKA = await prisma.venue.findUniqueOrThrow({ where: { slug: "bar-polka" } });
const KITAP = await prisma.venue.findUniqueOrThrow({ where: { slug: "kofe-kitap" } });

const users: string[] = [];
const offers: string[] = [];
const presences: string[] = [];

const mkUser = async (role: "user" | "admin" = "user") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Айгерим",
      verifiedAt: new Date(),
      role,
    },
  });
  users.push(u.id);
  return u.id;
};
const as = async (userId: string | null) => {
  jar.clear();
  if (userId) await startSession({ userId });
};
const openAt = async (venueId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const id = `web-places-${venueId}-${presences.length}`;
    presences.push(id);
    await startPresence(redis, id, venueId, `visit-${id}`);
    await setOpenToMeet(redis, id, true);
  }
};
const mkOffer = async (data: Record<string, unknown>) => {
  const o = await prisma.offer.create({
    data: {
      venueId: KITAP.id,
      type: "discount",
      placement: "badge",
      title: "Кофе с собой −20%",
      startsAt: new Date(Date.now() - 3600_000),
      endsAt: new Date(Date.now() + 86_400_000),
      status: "approved",
      ...data,
    } as Parameters<typeof prisma.offer.create>[0]["data"],
  });
  offers.push(o.id);
  return o;
};
let ip = 0;
const post = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    headers: { "x-forwarded-for": `10.11.0.${++ip % 250}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const get = (url = "http://x") => new Request(url);
const ctx = <K extends string>(key: K, value: string) =>
  ({ params: Promise.resolve({ [key]: value }) }) as { params: Promise<Record<K, string>> };
type Places = {
  items: { slug: string; activity: string | null; isPartner: boolean; distanceM?: number }[];
  promos: { id: string; isAd: boolean }[];
  event: { id: string } | null;
};
const list = async (body: Record<string, unknown> = { city: "almaty" }) => {
  const res = await places(post(body));
  expect(res.status).toBe(200);
  const text = await res.text();
  return { text, data: JSON.parse(text) as Places };
};
/** Ни координат, ни точных чисел людей, ни пола и возраста. */
const FORBIDDEN =
  /"(lat|lng|latitude|longitude|location|geofence|coordinates|gender|age|birthDate|count|openCount|openPeak|people|photo|userId)"/;

beforeAll(async () => {
  await redis.del(ACTIVITY_KEY);
  await openAt(POLKA.id, 2);
  await openAt(TEPLYI.id, 4);
  await snapshotActivity({ db: prisma, redis });
});

afterAll(async () => {
  for (const id of presences) await endPresence(redis, id);
  await redis.del(ACTIVITY_KEY);
  await prisma.offer.deleteMany({ where: { id: { in: offers } } });
  await prisma.offer.deleteMany({ where: { title: { startsWith: "Тест модерации" } } });
  await prisma.session.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("Где знакомятся сейчас", () => {
  it("открыто без входа, активность только диапазоном и только от 3", async () => {
    await as(null);
    const { text, data } = await list();
    expect(text).not.toMatch(FORBIDDEN);
    const teplyi = data.items.find((i) => i.slug === "teplyi-ugol");
    const polka = data.items.find((i) => i.slug === "bar-polka");
    expect(teplyi?.activity).toBe("3-5");
    expect(polka?.activity).toBeNull();
    for (const i of data.items) expect([null, "3-5", "5-10", "10+"]).toContain(i.activity);
    // Оживлённое место первым, затем партнёры.
    expect(data.items[0]?.slug).toBe("teplyi-ugol");
    const firstNonPartner = data.items.findIndex((i) => !i.isPartner && !i.activity);
    expect(data.items.slice(firstNonPartner).every((i) => !i.isPartner)).toBe(true);
  });

  it("предложения: только одобренные и в своё время, платное — «Реклама»", async () => {
    await mkOffer({ title: "Ждёт модерации", status: "pending" });
    await mkOffer({ title: "Ещё не началось", startsAt: new Date(Date.now() + 3600_000) });
    const ad = await mkOffer({ title: "Десерт дня", isPaid: true });
    const promo = await mkOffer({ title: "Промо недели", placement: "promo_card", isPaid: true });
    const { data } = await list();
    const kitap = data.items.find((i) => i.slug === "kofe-kitap") as unknown as {
      offer: { title: string; isAd: boolean } | null;
    };
    expect(kitap.offer).toEqual({ title: ad.title, isAd: true, byInterests: false });
    expect(data.promos.map((p) => p.id)).toContain(promo.id);
    expect(data.promos.find((p) => p.id === promo.id)?.isAd).toBe(true);
    const stats = await prisma.offerStatsDaily.findMany({ where: { offerId: ad.id } });
    expect(stats[0]?.impressions).toBeGreaterThan(0);
  });

  it("«Рядом»: расстояние округлено до 100 м, точка нигде не сохраняется", async () => {
    const before = await prisma.analyticsEvent.count();
    const { text, data } = await list({
      city: "almaty",
      sort: "near",
      near: { lat: 43.2399, lng: 76.9464 },
    });
    expect(text).not.toMatch(FORBIDDEN);
    expect(["teplyi-ugol", "bar-polka"]).toContain(data.items[0]?.slug);
    for (const i of data.items) expect(i.distanceM! % 100).toBe(0);
    expect(await prisma.analyticsEvent.count()).toBe(before);
  });

  it("страница места: популярные часы уровнями, без людей и координат", async () => {
    const res = await place(get(), ctx("slug", "teplyi-ugol"));
    const text = await res.text();
    expect(text).not.toMatch(FORBIDDEN);
    const p = JSON.parse(text) as { activity: string; popularHours: number[][] };
    expect(p.activity).toBe("3-5");
    expect(p.popularHours).toHaveLength(7);
    for (const d of p.popularHours) for (const l of d) expect([0, 1, 2, 3]).toContain(l);
    expect((await place(get(), ctx("slug", "net-takogo"))).status).toBe(404);
  });

  it("топ недели — только места, без чисел", async () => {
    const res = await top(get("http://x?city=almaty"));
    const text = await res.text();
    expect(text).not.toMatch(/score|openPeak|checkins|\d{2,}/);
    expect((await top(get("http://x?city=london"))).status).toBe(400);
  });
});

describe("коды скидок", () => {
  it("нужен вход, код не связан с человеком, есть лимит", async () => {
    const offer = await mkOffer({ title: "Капучино −30%" });
    await as(null);
    expect((await offerCode(post(), ctx("id", offer.id))).status).toBe(401);
    const u = await mkUser();
    await as(u);
    const res = await offerCode(post(), ctx("id", offer.id));
    expect(res.status).toBe(201);
    const { code } = (await res.json()) as { code: string };
    const row = await prisma.offerRedemption.findUniqueOrThrow({ where: { code } });
    expect(JSON.stringify(row)).not.toContain(u);
    for (let i = 1; i < 10; i++) await offerCode(post(), ctx("id", offer.id));
    expect((await offerCode(post(), ctx("id", offer.id))).status).toBe(429);
    await as(await mkUser());
    const event = await mkOffer({ title: "Вечер знакомств", type: "event" });
    expect((await offerCode(post(), ctx("id", event.id))).status).toBe(404);
    expect((await offerClick(post(), ctx("id", event.id))).status).toBe(204);
  });
});

describe("админка предложений, отчётов и воронки", () => {
  it("не-модератору — 404", async () => {
    const offer = await mkOffer({ title: "Для модерации", status: "pending" });
    for (const who of [null, await mkUser()]) {
      await as(who);
      expect((await adminOffers()).status).toBe(404);
      expect((await adminCreate(post({}))).status).toBe(404);
      expect(
        (await adminModerate(post({ decision: "approved" }), ctx("id", offer.id))).status,
      ).toBe(404);
      expect((await adminPartners()).status).toBe(404);
      expect((await adminFunnel(get())).status).toBe(404);
    }
  });

  it("предложение создаётся на модерацию, алкоголь одобрить нельзя", async () => {
    await as(await mkUser("admin"));
    const base = {
      venueSlug: "kofe-kitap",
      type: "promo",
      placement: "badge",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect(
      (await adminCreate(post({ ...base, title: "Тест модерации", endsAt: base.startsAt }))).status,
    ).toBe(400);
    expect(
      (await adminCreate(post({ ...base, title: "Тест модерации", placement: "event_of_day" })))
        .status,
    ).toBe(400);
    const res = await adminCreate(post({ ...base, title: "Тест модерации: вино 2 по цене 1" }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    const listed = (await (await adminOffers()).json()) as {
      offers: { id: string; alcohol: boolean }[];
    };
    expect(listed.offers.find((o) => o.id === id)?.alcohol).toBe(true);
    const approve = await adminModerate(post({ decision: "approved" }), ctx("id", id));
    expect(approve.status).toBe(422);
    expect((await prisma.offer.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
  });

  it("воронка и отчёт партнёрам — только счётчики", async () => {
    await as(null);
    const before = await prisma.analyticsEvent.count({ where: { type: "app_open" } });
    expect((await appOpen(post())).status).toBe(204);
    const ev = await prisma.analyticsEvent.findFirstOrThrow({
      where: { type: "app_open" },
      orderBy: { createdAt: "desc" },
    });
    expect(await prisma.analyticsEvent.count({ where: { type: "app_open" } })).toBe(before + 1);
    expect(ev.venueId).toBeNull();

    await as(await mkUser("admin"));
    const funnel = await adminFunnel(get("http://x?days=7"));
    const text = await funnel.text();
    expect(text).not.toMatch(/phone|userId|displayName|\+7/);
    const f = JSON.parse(text) as {
      days: number;
      rows: { venueName: string | null; counts: Record<string, number> }[];
    };
    expect(f.days).toBe(7);
    expect(f.rows.find((r) => r.venueName === null)?.counts.app_open).toBeGreaterThan(0);

    const partners = await (await adminPartners()).text();
    expect(partners).not.toMatch(/phone|userId|displayName|code"/);
    expect(partners).toContain("Kofe Kitap");
  });
});

describe("предложения по интересам (правило 14)", () => {
  type PlaceOffers = { offers: { id: string; byInterests: boolean }[] };
  const offersAt = async () =>
    ((await (await place(get(), ctx("slug", "kofe-kitap"))).json()) as PlaceOffers).offers;
  const withInterests = async (interestIds: string[], adsConsent: boolean) => {
    const id = await mkUser();
    await prisma.user.update({
      where: { id },
      data: {
        adsConsent,
        interests: { create: interestIds.map((interestId) => ({ interestId })) },
      },
    });
    return id;
  };

  it("видят только те, кто сам включил согласие и у кого есть такой интерес", async () => {
    const [books, sport] = await prisma.interest.findMany({
      take: 2,
      orderBy: { sortOrder: "asc" },
    });
    const targeted = await mkOffer({
      title: "Книжный вечер −15%",
      interests: { create: [{ interestId: books!.id }] },
    });
    const general = await mkOffer({ title: "Для всех −10%" });

    const visible = async (userId: string | null) => {
      await as(userId);
      const ids = (await offersAt()).map((o) => o.id);
      expect(ids).toContain(general.id);
      return ids.includes(targeted.id);
    };
    expect(await visible(null)).toBe(false);
    // Интерес есть, но согласия нет — интересы не используются.
    expect(await visible(await withInterests([books!.id], false))).toBe(false);
    // Согласие есть, но интерес другой.
    expect(await visible(await withInterests([sport!.id], true))).toBe(false);
    const fan = await withInterests([books!.id, sport!.id], true);
    expect(await visible(fan)).toBe(true);
    const shown = (await offersAt()).find((o) => o.id === targeted.id);
    expect(shown?.byInterests).toBe(true);
    expect((await offersAt()).find((o) => o.id === general.id)?.byInterests).toBe(false);

    // В общем списке мест — так же.
    await as(await withInterests([books!.id], false));
    expect((await list()).text).not.toContain("Книжный вечер");

    // Код скидки по такому предложению — тоже только своей аудитории.
    expect((await offerCode(post(), ctx("id", targeted.id))).status).toBe(404);
    await as(fan);
    expect((await offerCode(post(), ctx("id", targeted.id))).status).toBe(201);

    // Выключил согласие — предложение сразу пропало.
    await prisma.user.update({ where: { id: fan }, data: { adsConsent: false } });
    expect((await offersAt()).map((o) => o.id)).not.toContain(targeted.id);
  });

  it("модератор задаёт интересы; несуществующий интерес — 400", async () => {
    await as(await mkUser("admin"));
    const [books] = await prisma.interest.findMany({ take: 1, orderBy: { sortOrder: "asc" } });
    const base = {
      venueSlug: "kofe-kitap",
      type: "promo",
      placement: "badge",
      title: "Тест модерации: по интересам",
      startsAt: new Date().toISOString(),
      endsAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    expect((await adminCreate(post({ ...base, interestIds: ["nope"] }))).status).toBe(400);
    const res = await adminCreate(post({ ...base, interestIds: [books!.id] }));
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await prisma.offerInterest.count({ where: { offerId: id } })).toBe(1);
    const listed = (await (await adminOffers()).json()) as {
      offers: { id: string; interests: string[] }[];
    };
    expect(listed.offers.find((o) => o.id === id)?.interests).toEqual([books!.nameRu]);
  });
});
