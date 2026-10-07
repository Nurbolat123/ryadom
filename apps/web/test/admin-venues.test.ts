import { afterAll, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { findVenuesAtPoint, prisma } = await import("@ryadom/db");
const { linkKey } = await import("@ryadom/gifts");
const { getPresence, setOpenToMeet, startPresence } = await import("@ryadom/presence");
const venues = await import("@/app/api/admin/venues/route");
const venue = await import("@/app/api/admin/venues/[id]/route");
const geofence = await import("@/app/api/admin/venues/[id]/geofence/route");
const menu = await import("@/app/api/admin/venues/[id]/menu/route");
const menuItem = await import("@/app/api/admin/venues/[id]/menu/[itemId]/route");
const telegram = await import("@/app/api/admin/venues/[id]/telegram/route");
const imports = await import("@/app/api/admin/imports/route");
const suggestions = await import("@/app/api/admin/suggestions/route");
const suggestion = await import("@/app/api/admin/suggestions/[id]/route");
const { OverpassVenueSource } = await import("@ryadom/venues");
const OSM_ATTRIBUTION = new OverpassVenueSource().attribution;
const { startImport } = await import("@/lib/server/admin-venues");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");

// Точка в Алматы в стороне от сидовых заведений.
const SPOT = { lat: 43.2552, lng: 76.9286 };
const NAME = `Админ-тест ${Date.now()}`;

const users: string[] = [];
const createdVenues: string[] = [];
const mkUser = async (role: "user" | "admin" = "user") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7708${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1994-01-01"),
      gender: "male",
      displayName: "Модератор",
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
      role,
    },
  });
  users.push(u.id);
  return u;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const req = (method: string, body?: unknown, url = "http://x") =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
const json = async <T>(r: Response | Promise<Response>) => (await (await r).json()) as T;

const admin = await mkUser("admin");
const newVenue = async (name = NAME) => {
  await as(admin.id);
  const r = await venues.POST(req("POST", { name, category: "coffee", ...SPOT }));
  expect(r.status).toBe(201);
  const { id } = await json<{ id: string }>(r);
  createdVenues.push(id);
  return id;
};
/** Точка в ~d метрах к северу от SPOT. */
const north = (d: number): [number, number] => [SPOT.lng, SPOT.lat + d / 111_320];

afterAll(async () => {
  await prisma.menuItem.deleteMany({ where: { venueId: { in: createdVenues } } });
  await prisma.venueSuggestion.deleteMany({ where: { name: { startsWith: "Админ-тест" } } });
  await prisma.venue.deleteMany({ where: { id: { in: createdVenues } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("админка заведений: доступ", () => {
  it("не-модератору и без входа все разделы отвечают 404", async () => {
    const id = await newVenue(`${NAME} доступ`);
    const user = await mkUser();
    for (const who of [user.id, null]) {
      jar.clear();
      if (who) await startSession({ userId: who });
      const statuses = await Promise.all([
        venues.GET(req("GET")),
        venues.POST(req("POST", { name: "Х", category: "cafe", ...SPOT })),
        venue.GET(req("GET"), ctx({ id })),
        venue.PATCH(req("PATCH", { isPartner: true }), ctx({ id })),
        geofence.PUT(req("PUT", { ...SPOT, radiusM: 40 }), ctx({ id })),
        geofence.DELETE(req("DELETE"), ctx({ id })),
        menu.POST(req("POST", {}), ctx({ id })),
        menuItem.PATCH(req("PATCH", {}), ctx({ id, itemId: "x" })),
        menuItem.DELETE(req("DELETE"), ctx({ id, itemId: "x" })),
        telegram.POST(req("POST"), ctx({ id })),
        telegram.DELETE(req("DELETE"), ctx({ id })),
        imports.GET(),
        imports.POST(req("POST", { city: "almaty" })),
        suggestions.GET(),
        suggestion.POST(req("POST", { decision: "rejected" }), ctx({ id: "x" })),
      ]);
      expect(statuses.map((r) => r.status)).toEqual(statuses.map(() => 404));
    }
    expect((await prisma.venue.findUniqueOrThrow({ where: { id } })).isPartner).toBe(false);
  });
});

describe("заведения", () => {
  it("поиск по названию и фильтр «Партнёры»", async () => {
    await as(admin.id);
    const found = await json<{ venues: { slug: string }[] }>(
      venues.GET(req("GET", undefined, "http://x?q=тёплый")),
    );
    expect(found.venues.map((v) => v.slug)).toContain("teplyi-ugol");
    const partners = await json<{ venues: { isPartner: boolean }[]; total: number }>(
      venues.GET(req("GET", undefined, "http://x?filter=partners")),
    );
    expect(partners.total).toBeGreaterThanOrEqual(3);
    expect(partners.venues.every((v) => v.isPartner)).toBe(true);
  });

  it("новое заведение: круг 35 м, ручная геозона; город по точке, вне городов — нельзя", async () => {
    const id = await newVenue();
    const v = await json<{
      venue: { geofenceKind: string; source: string; geometry: { areaM2: number } };
    }>(venue.GET(req("GET"), ctx({ id })));
    expect(v.venue.source).toBe("admin");
    expect(v.venue.geofenceKind).toBe("manual");
    // π·35² ≈ 3848 м²
    expect(v.venue.geometry.areaM2).toBeGreaterThan(3700);
    expect(v.venue.geometry.areaM2).toBeLessThan(3900);
    expect((await findVenuesAtPoint(prisma, north(20), 50)).map((c) => c.id)).toContain(id);

    expect((await prisma.venue.findUniqueOrThrow({ where: { id } })).city).toBe("Алматы");

    // Город — по точке: в Астане — Астана, в степи — нельзя.
    const astana = await venues.POST(
      req("POST", { name: `${NAME} Астана`, category: "cafe", lat: 51.16, lng: 71.47 }),
    );
    expect(astana.status).toBe(201);
    const { id: astanaId } = await json<{ id: string }>(astana);
    createdVenues.push(astanaId);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: astanaId } })).city).toBe("Астана");
    const far = await venues.POST(
      req("POST", { name: `${NAME} вне`, category: "cafe", lat: 48, lng: 68 }),
    );
    expect(far.status).toBe(422);
    expect(await json(far)).toEqual({ error: "outside_cities" });
  });

  it("партнёр, комиссия и максимум подарка; slug и источник не меняются", async () => {
    const id = await newVenue();
    expect(
      (
        await venue.PATCH(
          req("PATCH", { isPartner: true, commissionPct: 10, maxGiftAmount: 3000 }),
          ctx({ id }),
        )
      ).status,
    ).toBe(200);
    const saved = await prisma.venue.findUniqueOrThrow({ where: { id } });
    expect(saved.isPartner).toBe(true);
    expect(Number(saved.commissionPct)).toBe(10);
    expect(saved.maxGiftAmount).toBe(300_000); // в тиынах
    await venue.PATCH(req("PATCH", { commissionPct: null, maxGiftAmount: null }), ctx({ id }));
    const reset = await prisma.venue.findUniqueOrThrow({ where: { id } });
    expect(reset.commissionPct).toBeNull();
    expect(reset.maxGiftAmount).toBeNull();

    for (const bad of [{ commissionPct: 60 }, { slug: "x" }, { source: "osm" }, { name: "" }]) {
      expect((await venue.PATCH(req("PATCH", bad), ctx({ id }))).status).toBe(400);
    }
  });

  it("закрытое заведение: все отмеченные в нём сразу сняты с отметки", async () => {
    const id = await newVenue();
    const guest = await mkUser();
    const visit = await prisma.visit.create({ data: { userId: guest.id, venueId: id } });
    await startPresence(redis, guest.id, id, visit.id);
    await setOpenToMeet(redis, guest.id, true);

    await as(admin.id);
    expect((await venue.PATCH(req("PATCH", { isActive: false }), ctx({ id }))).status).toBe(200);
    expect(await getPresence(redis, guest.id)).toBeNull();
    expect(
      (await prisma.visit.findUniqueOrThrow({ where: { id: visit.id } })).endedAt,
    ).not.toBeNull();
    // Неактивное заведение чек-ин не находит.
    expect((await findVenuesAtPoint(prisma, north(0), 50)).map((c) => c.id)).not.toContain(id);
  });
});

describe("геозона", () => {
  it("ручной круг: другой радиус и точка; границы радиуса и города", async () => {
    const id = await newVenue();
    await as(admin.id);
    expect((await findVenuesAtPoint(prisma, north(60), 50)).map((c) => c.id)).not.toContain(id);
    const ok = await geofence.PUT(req("PUT", { ...SPOT, radiusM: 80 }), ctx({ id }));
    expect(ok.status).toBe(200);
    expect((await findVenuesAtPoint(prisma, north(60), 50)).map((c) => c.id)).toContain(id);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id } })).geofenceKind).toBe("manual");

    for (const radiusM of [5, 500])
      expect((await geofence.PUT(req("PUT", { ...SPOT, radiusM }), ctx({ id }))).status).toBe(400);
    const astana = await geofence.PUT(
      req("PUT", { lat: 51.16, lng: 71.47, radiusM: 40 }),
      ctx({ id }),
    );
    expect(astana.status).toBe(422);
    // Вернуть импорту можно только место из OSM.
    expect((await geofence.DELETE(req("DELETE"), ctx({ id }))).status).toBe(409);
  });

  it("место из OSM: ручную геозону можно вернуть импорту", async () => {
    const id = await newVenue();
    await prisma.venue.update({
      where: { id },
      data: { source: "osm", sourceId: `node/${Date.now()}` },
    });
    await as(admin.id);
    expect((await geofence.DELETE(req("DELETE"), ctx({ id }))).status).toBe(200);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id } })).geofenceKind).toBe("circle");
  });
});

describe("меню", () => {
  const item = {
    name: "Капучино",
    price: 1200,
    isAlcohol: false,
    giftable: true,
    isAvailable: true,
  };

  it("алкоголь нельзя сделать подарком (правило 8)", async () => {
    const id = await newVenue();
    const r = await menu.POST(
      req("POST", { ...item, name: "Пиво", isAlcohol: true, giftable: true }),
      ctx({ id }),
    );
    expect(r.status).toBe(400);
    expect(await json<{ error: string }>(r)).toEqual({ error: "alcohol_not_giftable" });
    expect(await prisma.menuItem.count({ where: { venueId: id } })).toBe(0);

    const beer = await menu.POST(
      req("POST", { ...item, name: "Пиво", isAlcohol: true, giftable: false }),
      ctx({ id }),
    );
    expect(beer.status).toBe(201);
    const { item: created } = await json<{ item: { id: string } }>(beer);
    const upd = await menuItem.PATCH(
      req("PATCH", { ...item, name: "Пиво", isAlcohol: true, giftable: true }),
      ctx({ id, itemId: created.id }),
    );
    expect(upd.status).toBe(400);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: created.id } })).giftable).toBe(
      false,
    );
  });

  it("добавить, поправить, удалить; цена — в тенге, хранится в тиынах", async () => {
    const id = await newVenue();
    const r = await menu.POST(req("POST", { ...item, nameKk: "Капучино" }), ctx({ id }));
    expect(r.status).toBe(201);
    const { item: created } = await json<{ item: { id: string; price: number } }>(r);
    expect(created.price).toBe(1200);
    expect((await prisma.menuItem.findUniqueOrThrow({ where: { id: created.id } })).price).toBe(
      120_000,
    );

    const upd = await menuItem.PATCH(
      req("PATCH", { ...item, price: 1300, isAvailable: false }),
      ctx({ id, itemId: created.id }),
    );
    expect(upd.status).toBe(200);
    const saved = await prisma.menuItem.findUniqueOrThrow({ where: { id: created.id } });
    expect(saved.price).toBe(130_000);
    expect(saved.isAvailable).toBe(false);

    // Чужое заведение — как будто позиции нет.
    const other = await newVenue();
    expect(
      (await menuItem.DELETE(req("DELETE"), ctx({ id: other, itemId: created.id }))).status,
    ).toBe(404);
    expect((await menuItem.DELETE(req("DELETE"), ctx({ id, itemId: created.id }))).status).toBe(
      200,
    );
    expect(await prisma.menuItem.findUnique({ where: { id: created.id } })).toBeNull();
  });
});

describe("Telegram персонала", () => {
  it("код привязки ведёт к заведению; отвязать — заказы больше не уходят", async () => {
    const id = await newVenue();
    await as(admin.id);
    const { code, ttlMinutes } = await json<{ code: string; ttlMinutes: number }>(
      telegram.POST(req("POST"), ctx({ id })),
    );
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(ttlMinutes).toBe(60);
    expect(await redis.get(linkKey(code))).toBe(id);
    await redis.del(linkKey(code));

    await prisma.venue.update({ where: { id }, data: { telegramChatId: "-100123" } });
    expect((await telegram.DELETE(req("DELETE"), ctx({ id }))).status).toBe(200);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id } })).telegramChatId).toBeNull();
  });
});

describe("«Нет моего заведения»", () => {
  const mkSuggestion = (name: string, category: "cafe" | null = null) =>
    prisma.venueSuggestion.create({
      data: { name, city: "Алматы", category, userId: admin.id, address: "Абая, 1" },
    });

  it("модератор не видит, кто предложил место", async () => {
    const s = await mkSuggestion(`${NAME} кто`);
    await as(admin.id);
    const raw = JSON.stringify(await json(suggestions.GET()));
    expect(raw).toContain(s.id);
    expect(raw).not.toContain(admin.id);
    expect(raw).not.toContain("userId");
  });

  it("одобрение: нужна категория и точка в городе; создаётся место с кругом 35 м", async () => {
    const s = await mkSuggestion(`${NAME} кофе`);
    await as(admin.id);
    const noCat = await suggestion.POST(
      req("POST", { decision: "approved", ...SPOT }),
      ctx({ id: s.id }),
    );
    expect(noCat.status).toBe(400);
    const far = await suggestion.POST(
      req("POST", { decision: "approved", category: "coffee", lat: 51.16, lng: 71.47 }),
      ctx({ id: s.id }),
    );
    expect(far.status).toBe(422);

    const ok = await suggestion.POST(
      req("POST", { decision: "approved", category: "coffee", ...SPOT }),
      ctx({ id: s.id }),
    );
    expect(ok.status).toBe(200);
    const { venueId } = await json<{ venueId: string }>(ok);
    createdVenues.push(venueId);
    const v = await prisma.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(v.source).toBe("user");
    expect(v.geofenceKind).toBe("manual");

    const again = await suggestion.POST(req("POST", { decision: "rejected" }), ctx({ id: s.id }));
    expect(again.status).toBe(409);
  });

  it("отклонение", async () => {
    const s = await mkSuggestion(`${NAME} нет`, "cafe");
    await as(admin.id);
    expect(
      (await suggestion.POST(req("POST", { decision: "rejected" }), ctx({ id: s.id }))).status,
    ).toBe(200);
    expect((await prisma.venueSuggestion.findUniqueOrThrow({ where: { id: s.id } })).status).toBe(
      "rejected",
    );
  });
});

describe("импорт из OpenStreetMap", () => {
  it("второй импорт города не запускается, пока идёт первый; сбой пишется в журнал", async () => {
    let fail: ((e: Error) => void) | null = null;
    const slow = {
      kind: "osm" as const,
      attribution: OSM_ATTRIBUTION,
      fetchVenues: () => new Promise<never>((_, reject) => (fail = reject)),
    };
    await redis.del("venue-import-lock:almaty");
    const first = await startImport("almaty", slow);
    expect(first.ok).toBe(true);
    expect(await startImport("almaty", slow)).toEqual({ ok: false, error: "import_running" });
    expect(await startImport("paris", slow)).toEqual({ ok: false, error: "bad_city" });

    // Источник вызывается после записи в журнал — ждём, пока импорт до него дойдёт.
    await vi.waitFor(() => expect(fail).not.toBeNull());
    fail!(new Error("Overpass 504"));
    if (first.ok) await first.done;
    const run = await prisma.venueImportRun.findFirstOrThrow({
      where: { city: "Алматы" },
      orderBy: { startedAt: "desc" },
    });
    expect(run.status).toBe("failed");
    expect(run.error).toContain("504");
    await prisma.venueImportRun.delete({ where: { id: run.id } });

    // Замок снят — можно запускать снова.
    const next = await startImport("almaty", {
      kind: "osm",
      attribution: OSM_ATTRIBUTION,
      fetchVenues: async () => {
        throw new Error("Overpass 429");
      },
    });
    expect(next.ok).toBe(true);
    if (next.ok) await next.done;
    await prisma.venueImportRun.deleteMany({ where: { error: { contains: "Overpass 429" } } });
  });
});
