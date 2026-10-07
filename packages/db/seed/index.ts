import { config } from "dotenv";

config({ path: "../../.env" });

const { createPrismaClient, setVenueCircleGeofence, setVenuePolygonGeofence } =
  await import("../src/index");
const { interests } = await import("./interests");
const { pricesKZ } = await import("./prices");
const { venues } = await import("./venues");

/**
 * Сид. Идемпотентный: можно запускать повторно.
 * Пользователей не создаёт — они появятся после регистрации (этап 3).
 * В продакшене (NODE_ENV=production) — только интересы и цены: тестовые заведения с меню
 * там не нужны, настоящие приходят из импорта OpenStreetMap и админки.
 */
const db = createPrismaClient();

async function seedInterests() {
  for (const [i, it] of interests.entries()) {
    await db.interest.upsert({
      where: { slug: it.slug },
      create: { ...it, sortOrder: i },
      update: { nameRu: it.nameRu, nameKk: it.nameKk, sortOrder: i },
    });
  }
  console.info(`seed: интересов — ${interests.length}`);
}

async function seedPrices() {
  for (const p of pricesKZ) {
    await db.price.upsert({
      where: { countryCode_product: { countryCode: "KZ", product: p.product } },
      create: { countryCode: "KZ", product: p.product, amount: p.amount, currency: "KZT" },
      update: { amount: p.amount, currency: "KZT", isActive: true },
    });
  }
  console.info(`seed: цен — ${pricesKZ.length}`);
}

async function seedVenues() {
  for (const v of venues) {
    const [lng, lat] = v.location;
    // Prisma не умеет писать geography-колонки, поэтому upsert заведения — raw SQL.
    const [row] = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "Venue" ("id", "slug", "name", "category", "address", "city", "location",
                           "source", "sourceId", "isPartner", "isActive", "maxGiftAmount", "updatedAt")
      VALUES (${`seed_${v.slug}`}, ${v.slug}, ${v.name}, ${v.category}::"VenueCategory", ${v.address},
              'Алматы', ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
              'seed'::"VenueSourceKind", ${v.slug}, ${v.isPartner ?? true}, true, ${v.maxGiftAmount ?? null}, now())
      ON CONFLICT ("slug") DO UPDATE SET
        "name" = EXCLUDED."name", "category" = EXCLUDED."category", "address" = EXCLUDED."address",
        "isPartner" = EXCLUDED."isPartner", "isActive" = true, "maxGiftAmount" = EXCLUDED."maxGiftAmount",
        "updatedAt" = now()
      RETURNING "id"`;
    if (!row) throw new Error(`Не удалось сохранить заведение ${v.slug}`);

    if (v.polygon) await setVenuePolygonGeofence(db, row.id, v.location, v.polygon);
    else await setVenueCircleGeofence(db, row.id, v.location);

    // Меню пересоздаём, только пока по заведению не было подарков (на позиции ссылаются подарки).
    if ((await db.gift.count({ where: { venueId: row.id } })) > 0) {
      console.info(`seed: «${v.name}» — есть подарки, меню не трогаю`);
      continue;
    }
    await db.$transaction([
      db.menuItem.deleteMany({ where: { venueId: row.id } }),
      db.menuItem.createMany({
        data: v.menu.map((m, i) => ({
          venueId: row.id,
          name: m.name,
          nameKk: m.nameKk ?? null,
          price: m.price,
          isAlcohol: m.isAlcohol ?? false,
          giftable: m.giftable ?? false,
          sortOrder: i,
        })),
      }),
    ]);
    console.info(`seed: заведение «${v.name}» — позиций меню ${v.menu.length}`);
  }
}

try {
  await seedInterests();
  await seedPrices();
  if (process.env.NODE_ENV === "production")
    console.info("seed: продакшен — тестовые заведения пропущены");
  else await seedVenues();
  console.info("seed: готово");
} finally {
  await db.$disconnect();
}
