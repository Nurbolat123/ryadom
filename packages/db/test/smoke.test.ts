import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, findVenuesAtPoint } from "../src";

/**
 * Smoke-тесты этапа 1: схема, ограничения БД и сид.
 * Требуют поднятой базы с применёнными миграциями и сидом (pnpm db:deploy && pnpm db:seed).
 */
const db = createPrismaClient();

afterAll(async () => {
  await db.$disconnect();
});

const venueBySlug = async (slug: string) => db.venue.findUniqueOrThrow({ where: { slug } });

describe("сид", () => {
  it("создаёт 3 партнёрских заведения Алматы с меню", async () => {
    const partners = await db.venue.findMany({
      where: { isPartner: true, city: "Алматы" },
      include: { _count: { select: { menuItems: true } } },
    });
    expect(partners.length).toBeGreaterThanOrEqual(3);
    for (const v of partners) expect(v._count.menuItems).toBeGreaterThan(0);
  });

  it("у каждого заведения есть геозона", async () => {
    const [row] = await db.$queryRaw<{ missing: bigint }[]>`
      SELECT count(*) AS missing FROM "Venue" WHERE "geofence" IS NULL`;
    expect(Number(row?.missing)).toBe(0);
  });

  it("справочник интересов заполнен на двух языках", async () => {
    const empty = await db.interest.count({ where: { OR: [{ nameRu: "" }, { nameKk: "" }] } });
    expect(await db.interest.count()).toBeGreaterThan(20);
    expect(empty).toBe(0);
  });

  it("цены для Казахстана как в CLAUDE.md", async () => {
    const month = await db.price.findUniqueOrThrow({
      where: { countryCode_product: { countryCode: "KZ", product: "plus_month" } },
    });
    expect(month.amount).toBe(199000);
  });
});

describe("правило 8: алкоголь нельзя подарить", () => {
  it("в сиде нет giftable-алкоголя", async () => {
    expect(await db.menuItem.count({ where: { isAlcohol: true, giftable: true } })).toBe(0);
  });

  it("база отвергает позицию с isAlcohol и giftable одновременно", async () => {
    const venue = await venueBySlug("sad-na-panfilova");
    await expect(
      db.menuItem.create({
        data: {
          venueId: venue.id,
          name: "Шампанское",
          price: 500000,
          isAlcohol: true,
          giftable: true,
        },
      }),
    ).rejects.toThrow();
  });

  it("база не даёт сделать алкоголь подарком через update", async () => {
    const wine = await db.menuItem.findFirstOrThrow({ where: { isAlcohol: true } });
    await expect(
      db.menuItem.update({ where: { id: wine.id }, data: { giftable: true } }),
    ).rejects.toThrow();
  });
});

describe("геозоны (PostGIS)", () => {
  it("точка внутри круга находит заведение", async () => {
    const found = await findVenuesAtPoint(db, [76.9467, 43.2399]);
    expect(found.map((v) => v.slug)).toContain("teplyi-ugol");
  });

  it("точка в 20 м от центра — ещё внутри геозоны 35 м", async () => {
    // ~20 м на север: 1° широты ≈ 111 км.
    const found = await findVenuesAtPoint(db, [76.9467, 43.2399 + 20 / 111_000]);
    expect(found.map((v) => v.slug)).toContain("teplyi-ugol");
  });

  it("точка в 100 м от заведения — вне геозоны", async () => {
    const found = await findVenuesAtPoint(db, [76.9467, 43.2399 + 100 / 111_000]);
    expect(found.map((v) => v.slug)).not.toContain("teplyi-ugol");
  });

  it("полигон здания: точка внутри находит заведение", async () => {
    const found = await findVenuesAtPoint(db, [76.9578, 43.2339]);
    expect(found.map((v) => v.slug)).toContain("kofe-kitap");
  });

  it("результат поиска не содержит координат (правило 4)", async () => {
    const [venue] = await findVenuesAtPoint(db, [76.9467, 43.2399]);
    expect(Object.keys(venue ?? {}).sort()).toEqual([
      "address",
      "category",
      "id",
      "isPartner",
      "name",
      "slug",
    ]);
  });

  it("заведение нельзя создать без точки", async () => {
    await expect(
      db.venue.create({
        data: {
          slug: "no-point",
          name: "Без точки",
          category: "cafe",
          city: "Алматы",
          source: "admin",
        },
      }),
    ).rejects.toThrow();
  });
});

describe("ограничения на пары пользователей", () => {
  it("нельзя отправить симпатию самому себе и второй привет тому же человеку", async () => {
    const venue = await venueBySlug("teplyi-ugol");
    const mk = (phone: string) =>
      db.user.create({
        data: { phone, birthDate: new Date("1995-01-01"), gender: "other", displayName: "Тест" },
      });
    const a = await mk(`+7700000${Date.now() % 10000}1`);
    const b = await mk(`+7700000${Date.now() % 10000}2`);
    try {
      await expect(
        db.sympathy.create({ data: { fromUserId: a.id, toUserId: a.id, venueId: venue.id } }),
      ).rejects.toThrow();

      await db.hello.create({
        data: { fromUserId: a.id, toUserId: b.id, venueId: venue.id, message: "Привет!" },
      });
      // Правило 6: повторный привет нельзя, в том числе суперпривет.
      await expect(
        db.hello.create({
          data: {
            fromUserId: a.id,
            toUserId: b.id,
            venueId: venue.id,
            message: "Ещё раз",
            isSuper: true,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await db.user.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    }
  });
});
