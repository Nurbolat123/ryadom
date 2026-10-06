import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildOverpassQuery, CITIES, parseOverpass, slugify, uniqueSlug } from "../src";
import type { OverpassResponse } from "../src";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/overpass-astana-sample.json", import.meta.url), "utf8"),
) as OverpassResponse;

const { venues, stats } = parseOverpass(fixture);
const byId = (id: string) => venues.find((v) => v.sourceId === id);

describe("разбор ответа Overpass", () => {
  it("берёт только заведения с названием и не закрытые", () => {
    expect(venues).toHaveLength(8);
    expect(byId("node/1004")).toBeUndefined(); // без названия
    expect(byId("node/1007")).toBeUndefined(); // opening_hours=closed
    expect(stats.skipped).toBe(2);
  });

  it("здания не становятся заведениями", () => {
    expect(venues.some((v) => v.sourceId.startsWith("way/200"))).toBe(false);
  });

  it("категории: кофейня, кафе, бар, ресторан, коворкинг", () => {
    expect(byId("node/1006")?.category).toBe("coffee"); // cuisine=coffee_shop
    expect(byId("node/1001")?.category).toBe("coffee"); // «Кофейня» в названии
    expect(byId("node/1002")?.category).toBe("bar");
    expect(byId("relation/4001")?.category).toBe("restaurant");
    expect(byId("node/1005")?.category).toBe("coworking");
    expect(byId("node/1008")?.category).toBe("coworking"); // office=coworking
  });

  it("адрес из addr:street и addr:housenumber", () => {
    expect(byId("node/1001")?.address).toBe("Кенесары көшесі, 40");
    expect(byId("node/1002")?.address).toBeNull();
  });

  it("точке достаётся наименьшее здание, в котором она стоит (не весь ТЦ)", () => {
    const fp = byId("node/1001")?.footprint;
    expect(fp).not.toBeNull();
    const lats = fp!.map(([, lat]) => lat);
    // здание 2001 — 24 м по стороне, ТЦ 2002 — 140 м
    expect((Math.max(...lats) - Math.min(...lats)) * 111_320).toBeLessThan(30);
  });

  it("точка без здания остаётся без контура (будет круг 35 м)", () => {
    expect(byId("node/1002")?.footprint).toBeNull();
    expect(byId("relation/4001")?.footprint).toBeNull();
  });

  it("одно место точкой и контуром сливается в одно, контур сохраняется", () => {
    expect(byId("way/3001")).toBeUndefined();
    expect(byId("node/1003")?.footprint).not.toBeNull();
    expect(stats.duplicates).toBe(1);
  });

  it("запрос Overpass ограничен рамкой города и ищет здания вокруг точек", () => {
    const q = buildOverpassQuery(CITIES.astana);
    expect(q).toContain("[bbox:51.02,71.2,51.3,71.65]");
    expect(q).toContain('way(around.points:25)["building"]');
  });
});

describe("slug", () => {
  it("транслитерирует русский и казахский", () => {
    expect(slugify("Кофейня Әже")).toBe("kofeynya-azhe");
    expect(slugify("Қазақ Ұлттық Өнер")).toBe("qazaq-ulttyq-oner");
    expect(slugify("Coffee Boom!")).toBe("coffee-boom");
  });

  it("уникален: при совпадении добавляет номер", () => {
    const taken = new Set(["daily-bar"]);
    expect(uniqueSlug("Daily Bar", taken)).toBe("daily-bar-2");
    expect(uniqueSlug("Daily Bar", taken)).toBe("daily-bar-3");
    expect(uniqueSlug("☕", taken, "cafe")).toBe("cafe");
  });
});
