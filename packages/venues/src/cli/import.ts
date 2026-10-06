import "./env";
import { parseArgs } from "node:util";
import { createPrismaClient } from "@ryadom/db";
import { CITIES, getCity } from "../cities";
import { importVenues, type ImportReport } from "../import";
import { OverpassVenueSource } from "../osm/overpass-source";

const HELP = `Импорт заведений из OpenStreetMap (Overpass API).

  pnpm venues:import --city astana          один город
  pnpm venues:import --all                  все города (${Object.keys(CITIES).join(", ")})

Опции:
  --file <путь>   взять сохранённый ответ Overpass вместо запроса в сеть
  --save <путь>   сохранить ответ Overpass в файл
  --url <адрес>   другой сервер Overpass (по умолчанию OVERPASS_URL или overpass-api.de)`;

const { values } = parseArgs({
  options: {
    city: { type: "string" },
    all: { type: "boolean", default: false },
    file: { type: "string" },
    save: { type: "string" },
    url: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help || (!values.city && !values.all)) {
  console.info(HELP);
  process.exit(values.help ? 0 : 1);
}
if (values.all && values.file) {
  console.error("--file работает только с одним городом (--city)");
  process.exit(1);
}

const CATEGORY_RU: Record<string, string> = {
  cafe: "кафе",
  coffee: "кофейни",
  bar: "бары",
  restaurant: "рестораны",
  coworking: "коворкинги",
};

const print = (r: ImportReport, src: OverpassVenueSource) => {
  const s = src.lastStats;
  const cats = Object.entries(r.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${CATEGORY_RU[k] ?? k} ${n}`)
    .join(", ");
  console.info(
    [
      `\n${r.city}: загружено ${r.fetched} заведений`,
      `  новых ${r.created}, обновлено ${r.updated}, помечено неактивными ${r.deactivated}`,
      `  по категориям: ${cats || "—"}`,
      `  геозоны: контур здания ${r.geofences.building}, круг 35 м ${r.geofences.circle}, ручные ${r.geofences.manual}`,
      s ? `  пропущено без названия/закрытых ${s.skipped}, слито дублей ${s.duplicates}` : "",
      r.deactivationSkipped
        ? "  ⚠ источник вернул слишком мало мест — пропавшие НЕ деактивированы (проверьте ответ Overpass)"
        : "",
      `  всего активных заведений в городе: ${r.activeTotal}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
};

let cities;
try {
  cities = values.all ? Object.values(CITIES) : [getCity(values.city!)];
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const db = createPrismaClient();
let failed = false;
try {
  for (const city of cities) {
    const source = new OverpassVenueSource({
      url: values.url,
      fromFile: values.file,
      saveTo: values.save,
    });
    console.info(`${city.name}: запрашиваю ${values.file ? values.file : "Overpass API"}…`);
    try {
      print(await importVenues(db, source, city), source);
    } catch (error) {
      failed = true;
      console.error(
        `${city.name}: импорт не удался —`,
        error instanceof Error ? error.message : error,
      );
    }
  }
} finally {
  await db.$disconnect();
}
process.exit(failed ? 1 : 0);
