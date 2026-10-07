import { readFile, writeFile } from "node:fs/promises";
import type { CityConfig } from "../cities";
import type { SourceVenue, VenueSource } from "../source";
import { parseOverpass, type OverpassResponse, type ParseStats } from "./parse";
import { buildOverpassQuery } from "./query";

export const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type OverpassSourceOptions = {
  /** Адрес Overpass API (можно поднять свой или взять зеркало). */
  url?: string;
  /** Взять готовый ответ Overpass из файла вместо запроса в сеть. */
  fromFile?: string;
  /** Сохранить сырой ответ Overpass в файл (для повторного импорта без сети). */
  saveTo?: string;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: number[];
};

const RETRYABLE = new Set([429, 502, 503, 504]);

/** OpenStreetMap через Overpass API. Данные © участники OpenStreetMap, лицензия ODbL. */
export class OverpassVenueSource implements VenueSource {
  readonly kind = "osm" as const;
  readonly attribution = {
    text: "© участники OpenStreetMap",
    textKk: "© OpenStreetMap қатысушылары",
    license: "ODbL",
    url: "https://www.openstreetmap.org/copyright",
  };
  lastStats: ParseStats | null = null;

  constructor(private readonly opts: OverpassSourceOptions = {}) {}

  async fetchVenues(city: CityConfig): Promise<SourceVenue[]> {
    const data = this.opts.fromFile
      ? (JSON.parse(await readFile(this.opts.fromFile, "utf8")) as OverpassResponse)
      : await this.request(buildOverpassQuery(city));
    if (!Array.isArray(data?.elements)) throw new Error("Overpass: в ответе нет elements");
    if (this.opts.saveTo) await writeFile(this.opts.saveTo, JSON.stringify(data));
    const { venues, stats } = parseOverpass(data);
    this.lastStats = stats;
    return venues;
  }

  private async request(query: string): Promise<OverpassResponse> {
    const url = this.opts.url ?? process.env.OVERPASS_URL ?? DEFAULT_OVERPASS_URL;
    const doFetch = this.opts.fetchImpl ?? fetch;
    const delays = this.opts.retryDelaysMs ?? [10_000, 30_000, 60_000];
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "ryadom-venue-import/0.2",
        },
        body: new URLSearchParams({ data: query }),
      });
      if (res.ok) return (await res.json()) as OverpassResponse;
      const delay = delays[attempt];
      if (!RETRYABLE.has(res.status) || delay === undefined) {
        throw new Error(`Overpass ответил ${res.status} ${res.statusText}`);
      }
      console.warn(`Overpass ${res.status}, повтор через ${delay / 1000} с`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
