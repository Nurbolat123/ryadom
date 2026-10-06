import type { LngLat } from "@ryadom/db";
import type { VenueCategory } from "@ryadom/shared";
import type { CityConfig } from "./cities";

/** Заведение в том виде, в каком его отдаёт внешний источник. */
export type SourceVenue = {
  /** Стабильный идентификатор в источнике, например "node/123" в OSM. */
  sourceId: string;
  name: string;
  category: VenueCategory;
  address: string | null;
  location: LngLat;
  /** Контур здания, если источник его знает. */
  footprint: LngLat[] | null;
};

export type SourceAttribution = {
  /** Подпись в интерфейсе. */
  text: string;
  license: string;
  url: string;
};

/**
 * Источник заведений. Весь импорт идёт только через этот интерфейс:
 * сейчас OpenStreetMap (Overpass API), позже можно добавить 2ГИС.
 */
export interface VenueSource {
  readonly kind: "osm" | "dgis";
  readonly attribution: SourceAttribution;
  fetchVenues(city: CityConfig): Promise<SourceVenue[]>;
}
