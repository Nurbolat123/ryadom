import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaClient, findVenuesAtPoint, setVenueManualCircle } from "@ryadom/db";
import {
  importVenues,
  OverpassVenueSource,
  parseOverpass,
  type CityConfig,
  type OverpassResponse,
  type SourceVenue,
  type VenueSource,
} from "../src";

/**
 * Импорт на образце ответа Overpass в отдельный тестовый «город»,
 * чтобы не трогать настоящие заведения Астаны в базе разработчика.
 */
const db = createPrismaClient();
const FIXTURE = new URL("./fixtures/overpass-astana-sample.json", import.meta.url).pathname;
const city: CityConfig = {
  slug: "testcity",
  name: "Тестоград",
  timezone: "Asia/Almaty",
  bbox: [51.02, 71.2, 51.3, 71.65],
};
const CENTER: [number, number] = [71.4305, 51.1283];
const at = (dx: number, dy: number): [number, number] => [
  CENTER[0] + dx / (111_320 * Math.cos((CENTER[1] * Math.PI) / 180)),
  CENTER[1] + dy / 111_320,
];

/** Источник с заданным списком мест — для сценариев «место пропало». */
const fixedSource = (venues: SourceVenue[]): VenueSource => ({
  kind: "osm",
  attribution: { text: "test", license: "ODbL", url: "" },
  fetchVenues: async () => venues,
});

const cleanup = async () => {
  await db.venue.deleteMany({ where: { city: city.name } });
  await db.venueImportRun.deleteMany({ where: { city: city.name } });
};

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await db.$disconnect();
});

const slugsAtPoint = async (p: [number, number]) =>
  (await findVenuesAtPoint(db, p)).map((v) => v.slug);

describe("импорт заведений из OSM", () => {
  it("первый импорт создаёт все места и геозоны", async () => {
    const r = await importVenues(db, new OverpassVenueSource({ fromFile: FIXTURE }), city);
    expect(r.fetched).toBe(8);
    expect(r.created).toBe(8);
    expect(r.updated).toBe(0);
    // контур здания у «Кофейни Әже» и «Тюбетейки»; навес < 30 м² и огромный контур → круг
    expect(r.geofences).toEqual({ building: 2, circle: 6, manual: 0 });
    expect(r.activeTotal).toBe(8);

    const run = await db.venueImportRun.findUniqueOrThrow({ where: { id: r.runId } });
    expect(run.status).toBe("success");
  });

  it("геозона по контуру здания: внутри здания находит, в 30 м от него — нет", async () => {
    const venue = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "node/1001" },
    });
    expect(venue.geofenceKind).toBe("building");
    expect(await slugsAtPoint(at(8, 8))).toContain(venue.slug);
    expect(await slugsAtPoint(at(0, 40))).not.toContain(venue.slug);
  });

  it("геозона-круг 35 м: в 25 м находит, в 50 м — нет", async () => {
    const venue = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "node/1002" },
    });
    expect(venue.geofenceKind).toBe("circle");
    expect(await slugsAtPoint(at(400, 25))).toContain(venue.slug);
    expect(await slugsAtPoint(at(400, 50))).not.toContain(venue.slug);
  });

  it("огромный контур (квартал) заменяется кругом вокруг точки внутри него", async () => {
    const venue = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "way/3002" },
    });
    expect(venue.geofenceKind).toBe("circle");
    expect(await slugsAtPoint(at(-1500, -1500))).toContain(venue.slug);
    expect(await slugsAtPoint(at(-1500 + 200, -1500))).not.toContain(venue.slug);
  });

  it("slug читаемый и латиницей", async () => {
    const venue = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "node/1001" },
    });
    expect(venue.slug).toMatch(/^kofeynya-azhe(-\d+)?$/);
  });

  it("повторный импорт ничего не дублирует и не меняет slug", async () => {
    const before = await db.venue.findMany({
      where: { city: city.name },
      select: { id: true, slug: true },
    });
    const r = await importVenues(db, new OverpassVenueSource({ fromFile: FIXTURE }), city);
    expect(r.created).toBe(0);
    expect(r.updated).toBe(8);
    const after = await db.venue.findMany({
      where: { city: city.name },
      select: { id: true, slug: true },
    });
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toHaveLength(before.length);
  });

  it("ручную геозону импорт не перезаписывает", async () => {
    const venue = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "node/1002" },
    });
    await setVenueManualCircle(db, venue.id, at(400, 300), 40);
    await importVenues(db, new OverpassVenueSource({ fromFile: FIXTURE }), city);
    const again = await db.venue.findUniqueOrThrow({ where: { id: venue.id } });
    expect(again.geofenceKind).toBe("manual");
    expect(await slugsAtPoint(at(400, 300))).toContain(venue.slug);
    expect(await slugsAtPoint(at(400, 0))).not.toContain(venue.slug);
  });

  it("пропавшее из источника место помечается неактивным, а не удаляется", async () => {
    const all = parseOverpass(JSON.parse(readFileSync(FIXTURE, "utf8")) as OverpassResponse).venues;
    const withoutBar = all.filter((v) => v.sourceId !== "node/1006");
    const r = await importVenues(db, fixedSource(withoutBar), city);
    expect(r.deactivated).toBe(1);
    const gone = await db.venue.findFirstOrThrow({
      where: { city: city.name, sourceId: "node/1006" },
    });
    expect(gone.isActive).toBe(false);
    // неактивное заведение не находится при чек-ине
    expect(await slugsAtPoint(at(400, 600))).not.toContain(gone.slug);

    // вернулось в OSM — снова активно
    await importVenues(db, fixedSource(all), city);
    expect((await db.venue.findUniqueOrThrow({ where: { id: gone.id } })).isActive).toBe(true);
  });

  it("если источник вернул подозрительно мало мест, никого не деактивирует", async () => {
    const all = parseOverpass(JSON.parse(readFileSync(FIXTURE, "utf8")) as OverpassResponse).venues;
    const r = await importVenues(db, fixedSource(all.slice(0, 2)), city);
    expect(r.deactivationSkipped).toBe(true);
    expect(r.deactivated).toBe(0);
    expect(await db.venue.count({ where: { city: city.name, isActive: true } })).toBe(8);
  });

  it("сбой источника записывается в журнал импорта", async () => {
    const failing: VenueSource = {
      ...fixedSource([]),
      fetchVenues: async () => {
        throw new Error("Overpass ответил 504");
      },
    };
    await expect(importVenues(db, failing, city)).rejects.toThrow("504");
    const last = await db.venueImportRun.findFirstOrThrow({
      where: { city: city.name },
      orderBy: { startedAt: "desc" },
    });
    expect(last.status).toBe("failed");
    expect(last.error).toContain("504");
  });
});

describe("Overpass-клиент", () => {
  it("повторяет запрос при 429/504 и сдаётся на 400", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) return new Response("busy", { status: 429 });
      return new Response(readFileSync(FIXTURE, "utf8"), { status: 200 });
    }) as typeof fetch;
    const src = new OverpassVenueSource({ fetchImpl, retryDelaysMs: [1] });
    expect(await src.fetchVenues(city)).toHaveLength(8);
    expect(calls).toBe(2);

    const bad = new OverpassVenueSource({
      fetchImpl: (async () => new Response("bad query", { status: 400 })) as typeof fetch,
      retryDelaysMs: [1],
    });
    await expect(bad.fetchVenues(city)).rejects.toThrow("400");
  });
});
