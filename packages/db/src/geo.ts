import { RULES } from "@ryadom/shared";
import type { PrismaClient } from "./generated/prisma/client";

/**
 * Работа с PostGIS-колонками заведений. Prisma их не читает, поэтому только raw SQL.
 *
 * Правило 4: координаты пользователя используются только внутри запроса
 * и нигде не сохраняются; наружу эти функции координат не возвращают.
 */

/** Хватает и PrismaClient, и транзакции ($transaction). */
export type RawDb = Pick<PrismaClient, "$queryRaw" | "$executeRaw">;

export type LngLat = readonly [lng: number, lat: number];

/** WKT полигона из кольца точек; кольцо замыкается автоматически. */
export const polygonWkt = (polygon: readonly LngLat[]): string => {
  const ring = [...polygon];
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (!first || !last) throw new Error("Пустой полигон геозоны");
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return `POLYGON((${ring.map(([x, y]) => `${x} ${y}`).join(",")}))`;
};

/**
 * Контур здания годится как геозона, только если его площадь в этих пределах (м²).
 * Меньше — в него почти невозможно попасть с погрешностью GPS в помещении;
 * больше — это квартал или огромный ТЦ, лучше круг вокруг точки заведения.
 */
export const BUILDING_GEOFENCE_AREA_M2 = { min: 30, max: 30_000 } as const;

/** Записать точку заведения и геозону-круг радиусом radiusM вокруг неё. */
export const setVenueCircleGeofence = async (
  db: RawDb,
  venueId: string,
  [lng, lat]: LngLat,
  radiusM: number = RULES.defaultGeofenceRadiusMeters,
): Promise<void> => {
  await db.$executeRaw`
    UPDATE "Venue"
    SET "location" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        "geofence" = ST_Buffer(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM}, 'quad_segs=8'),
        "geofenceKind" = 'circle'
    WHERE "id" = ${venueId}`;
};

/** Записать точку заведения и геозону-полигон (например, контур здания из OSM). */
export const setVenuePolygonGeofence = async (
  db: RawDb,
  venueId: string,
  location: LngLat,
  polygon: readonly LngLat[],
): Promise<void> => {
  const wkt = polygonWkt(polygon);
  await db.$executeRaw`
    UPDATE "Venue"
    SET "location" = ST_SetSRID(ST_MakePoint(${location[0]}, ${location[1]}), 4326)::geography,
        "geofence" = ST_GeogFromText(${`SRID=4326;${wkt}`}),
        "geofenceKind" = 'building'
    WHERE "id" = ${venueId}`;
};

export type VenueCandidate = {
  id: string;
  slug: string;
  name: string;
  category: string;
  address: string | null;
  isPartner: boolean;
};

/**
 * Активные заведения, в геозону которых попадает точка, от ближайшего к дальнему.
 * Расстояния используются только для сортировки и наружу не отдаются.
 */
export const findVenuesAtPoint = async (
  db: RawDb,
  [lng, lat]: LngLat,
  limit: number = RULES.maxVenueCandidates,
): Promise<VenueCandidate[]> =>
  db.$queryRaw<VenueCandidate[]>`
    SELECT "id", "slug", "name", "category"::text AS "category", "address", "isPartner"
    FROM "Venue"
    WHERE "isActive"
      AND "geofence" IS NOT NULL
      AND ST_Covers("geofence", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
    ORDER BY ST_Distance("location", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography)
    LIMIT ${limit}`;

export type SourceVenueInput = {
  source: "osm" | "dgis";
  sourceId: string;
  /** Используется только при создании; у существующего заведения slug не меняется. */
  slug: string;
  name: string;
  category: string;
  address: string | null;
  city: string;
  timezone: string;
  /** Точка заведения (для OSM-узла — сам узел, для контура — любая точка внутри или центр). */
  location: LngLat;
  /** Контур здания, если есть. Негодный (самопересечения, слишком мал/велик) заменяется кругом. */
  footprint: readonly LngLat[] | null;
  seenAt: Date;
};

export type UpsertResult = {
  id: string;
  inserted: boolean;
  geofenceKind: "building" | "circle" | "manual";
};

/**
 * Создать или обновить заведение из внешнего источника вместе с геозоной.
 * Геозона: контур здания, если он годный, иначе круг RULES.defaultGeofenceRadiusMeters.
 * Заведения с ручной геозоной (geofenceKind = manual) сохраняют свою точку и геозону.
 */
export const upsertSourceVenue = async (db: RawDb, v: SourceVenueInput): Promise<UpsertResult> => {
  const [lng, lat] = v.location;
  const wkt = v.footprint && v.footprint.length >= 3 ? polygonWkt(v.footprint) : null;
  const [row] = await db.$queryRaw<UpsertResult[]>`
    WITH input AS (
      SELECT ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326) AS pt,
             CASE WHEN ${wkt}::text IS NULL THEN NULL
                  ELSE ST_GeomFromText(${wkt}::text, 4326) END AS poly_in
    ), shape AS (
      SELECT pt,
             CASE WHEN poly_in IS NOT NULL
                   AND ST_IsValid(poly_in)
                   AND ST_Area(poly_in::geography) BETWEEN ${BUILDING_GEOFENCE_AREA_M2.min} AND ${BUILDING_GEOFENCE_AREA_M2.max}
                  THEN poly_in END AS poly
      FROM input
    ), final AS (
      SELECT CASE WHEN poly IS NOT NULL AND NOT ST_Covers(poly, pt)
                  THEN ST_PointOnSurface(poly) ELSE pt END::geography AS location,
             poly
      FROM shape
    )
    INSERT INTO "Venue" ("id", "slug", "name", "category", "address", "city", "timezone",
                         "location", "geofence", "geofenceKind",
                         "source", "sourceId", "lastSeenAt", "isActive", "updatedAt")
    SELECT ${`${v.source}_${v.sourceId.replace("/", "_")}`}, ${v.slug}, ${v.name},
           ${v.category}::"VenueCategory", ${v.address}, ${v.city}, ${v.timezone},
           final.location,
           COALESCE(final.poly::geography,
                    ST_Buffer(final.location, ${RULES.defaultGeofenceRadiusMeters}, 'quad_segs=8')),
           (CASE WHEN final.poly IS NOT NULL THEN 'building' ELSE 'circle' END)::"GeofenceKind",
           ${v.source}::"VenueSourceKind", ${v.sourceId}, ${v.seenAt}, true, now()
    FROM final
    ON CONFLICT ("source", "sourceId") DO UPDATE SET
      "name" = EXCLUDED."name",
      "category" = EXCLUDED."category",
      "address" = EXCLUDED."address",
      "city" = EXCLUDED."city",
      "lastSeenAt" = EXCLUDED."lastSeenAt",
      "isActive" = true,
      "location" = CASE WHEN "Venue"."geofenceKind" = 'manual' THEN "Venue"."location" ELSE EXCLUDED."location" END,
      "geofence" = CASE WHEN "Venue"."geofenceKind" = 'manual' THEN "Venue"."geofence" ELSE EXCLUDED."geofence" END,
      "geofenceKind" = CASE WHEN "Venue"."geofenceKind" = 'manual' THEN "Venue"."geofenceKind" ELSE EXCLUDED."geofenceKind" END,
      "updatedAt" = now()
    RETURNING "id", (xmax = 0) AS "inserted", "geofenceKind"::text AS "geofenceKind"`;
  if (!row) throw new Error(`Не удалось сохранить заведение ${v.source}:${v.sourceId}`);
  return row;
};

/**
 * Пропавшие из источника заведения города помечаются неактивными (не удаляются).
 * Возвращает число деактивированных.
 */
export const deactivateMissingVenues = async (
  db: RawDb,
  source: "osm" | "dgis",
  city: string,
  seenAt: Date,
): Promise<number> =>
  db.$executeRaw`
    UPDATE "Venue" SET "isActive" = false, "updatedAt" = now()
    WHERE "source" = ${source}::"VenueSourceKind" AND "city" = ${city} AND "isActive"
      AND ("lastSeenAt" IS NULL OR "lastSeenAt" < ${seenAt})`;

/** Ручная геозона-круг (админка, одобрение «Нет моего заведения»). Импорт её не перезапишет. */
export const setVenueManualCircle = async (
  db: RawDb,
  venueId: string,
  [lng, lat]: LngLat,
  radiusM: number = RULES.defaultGeofenceRadiusMeters,
): Promise<void> => {
  await db.$executeRaw`
    UPDATE "Venue"
    SET "location" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
        "geofence" = ST_Buffer(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusM}, 'quad_segs=8'),
        "geofenceKind" = 'manual'
    WHERE "id" = ${venueId}`;
};

/** Создать заведение вручную (админка, одобренное «Нет моего заведения») с геозоной-кругом. */
export const createManualVenue = async (
  db: RawDb,
  v: {
    slug: string;
    name: string;
    category: string;
    address: string | null;
    city: string;
    timezone: string;
    source: "user" | "admin";
    location: LngLat;
  },
): Promise<string> => {
  const [lng, lat] = v.location;
  const [row] = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "Venue" ("id", "slug", "name", "category", "address", "city", "timezone",
                         "location", "geofence", "geofenceKind", "source", "isActive", "updatedAt")
    VALUES (gen_random_uuid()::text, ${v.slug}, ${v.name}, ${v.category}::"VenueCategory",
            ${v.address}, ${v.city}, ${v.timezone},
            ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
            ST_Buffer(ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography,
                      ${RULES.defaultGeofenceRadiusMeters}, 'quad_segs=8'),
            'manual', ${v.source}::"VenueSourceKind", true, now())
    RETURNING "id"`;
  if (!row) throw new Error("Не удалось создать заведение");
  return row.id;
};

/** Точка внутри геозоны конкретного активного заведения (перепроверка при повторном открытии). */
export const isPointInVenue = async (
  db: RawDb,
  venueId: string,
  [lng, lat]: LngLat,
): Promise<boolean> => {
  const [row] = await db.$queryRaw<{ inside: boolean }[]>`
    SELECT ST_Covers("geofence", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS inside
    FROM "Venue" WHERE "id" = ${venueId} AND "isActive" AND "geofence" IS NOT NULL`;
  return row?.inside === true;
};
