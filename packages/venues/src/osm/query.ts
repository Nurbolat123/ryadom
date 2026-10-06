import type { CityConfig } from "../cities";

/** Теги OSM, которые считаем заведениями. */
export const VENUE_AMENITIES = [
  "cafe",
  "bar",
  "pub",
  "biergarten",
  "nightclub",
  "restaurant",
  "coworking_space",
] as const;

/** Радиус поиска зданий вокруг точечных заведений, м. */
export const BUILDING_SEARCH_RADIUS_M = 25;

/**
 * Overpass QL: заведения города (узлы, контуры, мультиполигоны) с геометрией
 * и здания вокруг точечных заведений — чтобы взять их контур как геозону.
 */
export const buildOverpassQuery = (city: CityConfig): string => {
  const [s, w, n, e] = city.bbox;
  return `[out:json][timeout:300][bbox:${s},${w},${n},${e}];
(
  nwr["amenity"~"^(${VENUE_AMENITIES.join("|")})$"]["name"];
  nwr["office"="coworking"]["name"];
)->.venues;
.venues out tags geom;
node.venues->.points;
way(around.points:${BUILDING_SEARCH_RADIUS_M})["building"];
out tags geom;`;
};
