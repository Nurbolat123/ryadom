/**
 * Города, для которых импортируются заведения.
 * bbox — [юг, запад, север, восток], с запасом на окраины.
 */
export type CityConfig = {
  slug: string;
  /** Как город записан в Venue.city. */
  name: string;
  timezone: string;
  bbox: readonly [south: number, west: number, north: number, east: number];
};

export const CITIES = {
  astana: {
    slug: "astana",
    name: "Астана",
    timezone: "Asia/Almaty",
    bbox: [51.02, 71.2, 51.3, 71.65],
  },
  almaty: {
    slug: "almaty",
    name: "Алматы",
    timezone: "Asia/Almaty",
    bbox: [43.15, 76.75, 43.4, 77.1],
  },
} as const satisfies Record<string, CityConfig>;

export type CitySlug = keyof typeof CITIES;

export const getCity = (slug: string): CityConfig => {
  const city = (CITIES as Record<string, CityConfig>)[slug];
  if (!city) {
    throw new Error(`Неизвестный город «${slug}». Доступны: ${Object.keys(CITIES).join(", ")}`);
  }
  return city;
};
