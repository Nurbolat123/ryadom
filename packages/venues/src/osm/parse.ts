import type { LngLat } from "@ryadom/db";
import type { VenueCategory } from "@ryadom/shared";
import { distanceM, isClosedRing, pointInRing, ringAreaM2 } from "../geometry";
import type { SourceVenue } from "../source";
import { VENUE_AMENITIES } from "./query";

type Tags = Record<string, string>;
type LatLon = { lat: number; lon: number };
type Bounds = { minlat: number; minlon: number; maxlat: number; maxlon: number };

export type OverpassElement =
  | { type: "node"; id: number; lat: number; lon: number; tags?: Tags }
  | { type: "way"; id: number; geometry?: LatLon[]; bounds?: Bounds; tags?: Tags }
  | { type: "relation"; id: number; bounds?: Bounds; tags?: Tags };

export type OverpassResponse = { elements: OverpassElement[] };

export type ParseStats = { elements: number; skipped: number; duplicates: number };

const toLngLat = (p: LatLon): LngLat => [p.lon, p.lat];
const boundsCenter = (b: Bounds): LngLat => [(b.minlon + b.maxlon) / 2, (b.minlat + b.maxlat) / 2];

const isVenue = (tags: Tags | undefined): boolean =>
  !!tags &&
  ((VENUE_AMENITIES as readonly string[]).includes(tags.amenity ?? "") ||
    tags.office === "coworking");

const COFFEE_NAME = /(coffee|кофе|кофейн|espresso|эспрессо)/i;

export const categoryOf = (tags: Tags): VenueCategory => {
  if (tags.amenity === "coworking_space" || tags.office === "coworking") return "coworking";
  if (["bar", "pub", "biergarten", "nightclub"].includes(tags.amenity ?? "")) return "bar";
  if (tags.amenity === "restaurant") return "restaurant";
  const cuisine = tags.cuisine ?? "";
  const name = tags["name:ru"] ?? tags.name ?? "";
  if (/coffee_shop/.test(cuisine) || COFFEE_NAME.test(name)) return "coffee";
  return "cafe";
};

export const nameOf = (tags: Tags): string =>
  (tags["name:ru"] ?? tags.name ?? "").replace(/\s+/g, " ").trim();

export const addressOf = (tags: Tags): string | null => {
  const street = tags["addr:street"]?.trim();
  const house = tags["addr:housenumber"]?.trim();
  if (!street) return null;
  return house ? `${street}, ${house}` : street;
};

/** Заведение закрыто или временно не работает — не импортируем. */
const isClosed = (tags: Tags): boolean =>
  tags.opening_hours === "closed" || tags.disused === "yes" || tags.abandoned === "yes";

const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Одно и то же место бывает в OSM дважды: точкой и контуром. Сливаем в пределах 60 м. */
const DUPLICATE_RADIUS_M = 60;

/**
 * Разбор ответа Overpass в заведения.
 * - узел: точка = сам узел, геозона = наименьшее здание, в которое он попадает;
 * - замкнутый контур: геозона = сам контур;
 * - мультиполигон: точка = центр, геозона = круг.
 */
export const parseOverpass = (
  data: OverpassResponse,
): { venues: SourceVenue[]; stats: ParseStats } => {
  const buildings: { ring: LngLat[]; area: number }[] = [];
  const raw: SourceVenue[] = [];
  let skipped = 0;
  const seen = new Set<string>();

  for (const el of data.elements) {
    const key = `${el.type}/${el.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!isVenue(el.tags)) {
      if (el.type === "way" && el.tags?.building && el.geometry) {
        const ring = el.geometry.map(toLngLat);
        if (isClosedRing(ring)) buildings.push({ ring, area: ringAreaM2(ring) });
      }
      continue;
    }

    const tags = el.tags ?? {};
    const name = nameOf(tags);
    if (!name || isClosed(tags)) {
      skipped++;
      continue;
    }
    const base = { sourceId: key, name, category: categoryOf(tags), address: addressOf(tags) };

    if (el.type === "node") {
      raw.push({ ...base, location: [el.lon, el.lat], footprint: null });
    } else if (el.type === "way" && el.geometry?.length) {
      const ring = el.geometry.map(toLngLat);
      const location = el.bounds ? boundsCenter(el.bounds) : ring[0]!;
      raw.push({ ...base, location, footprint: isClosedRing(ring) ? ring : null });
    } else if (el.bounds) {
      raw.push({ ...base, location: boundsCenter(el.bounds), footprint: null });
    } else {
      skipped++;
    }
  }

  // Узлам — контур наименьшего здания, внутри которого они стоят.
  for (const v of raw) {
    if (v.footprint || !v.sourceId.startsWith("node/")) continue;
    let best: { ring: LngLat[]; area: number } | null = null;
    for (const b of buildings) {
      if ((!best || b.area < best.area) && pointInRing(v.location, b.ring)) best = b;
    }
    v.footprint = best?.ring ?? null;
  }

  // Дубли «точка + контур» с одним названием: оставляем точку (она точнее), берём контур у второй записи.
  const order = (v: SourceVenue) => (v.sourceId.startsWith("node/") ? 0 : 1);
  const sorted = [...raw].sort((a, b) => order(a) - order(b));
  const venues: SourceVenue[] = [];
  let duplicates = 0;
  for (const v of sorted) {
    const dup = venues.find(
      (k) =>
        normalizeName(k.name) === normalizeName(v.name) &&
        distanceM(k.location, v.location) <= DUPLICATE_RADIUS_M,
    );
    if (dup) {
      duplicates++;
      if (!dup.footprint && v.footprint) dup.footprint = v.footprint;
      continue;
    }
    venues.push(v);
  }

  return { venues, stats: { elements: data.elements.length, skipped, duplicates } };
};
