import "./env";
import { parseArgs } from "node:util";
import { createPrismaClient } from "@ryadom/db";
import { VenueCategory } from "@ryadom/shared";
import { approveVenueSuggestion, rejectVenueSuggestion } from "../suggestions";

/**
 * Модерация «Нет моего заведения» из командной строки (веб-админка — на этапе 7).
 */
const HELP = `Предложенные заведения («Нет моего заведения»).

  pnpm venues:suggestions list
  pnpm venues:suggestions approve <id> --lat 51.1283 --lng 71.4305 [--category cafe] [--name "Название"]
  pnpm venues:suggestions reject <id>

Категории: ${VenueCategory.join(", ")}
Точку удобно взять в 2ГИС или на openstreetmap.org (правый клик → «Показать адрес»).`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lat: { type: "string" },
    lng: { type: "string" },
    category: { type: "string" },
    name: { type: "string" },
  },
});
const [cmd, id] = positionals;

const db = createPrismaClient();
try {
  if (cmd === "list") {
    const rows = await db.venueSuggestion.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) console.info("Нет предложений на проверке.");
    for (const r of rows) {
      console.info(
        `${r.id}  ${r.city} · ${r.name}${r.category ? ` (${r.category})` : ""}` +
          `${r.address ? ` · ${r.address}` : ""}${r.comment ? `\n    «${r.comment}»` : ""}`,
      );
    }
  } else if (cmd === "approve" && id) {
    const res = await approveVenueSuggestion(db, id, {
      lat: Number(values.lat),
      lng: Number(values.lng),
      category: values.category as VenueCategory | undefined,
      name: values.name,
    });
    console.info(`Одобрено: заведение создано, ссылка /v/${res.slug}`);
  } else if (cmd === "reject" && id) {
    await rejectVenueSuggestion(db, id);
    console.info("Отклонено.");
  } else {
    console.info(HELP);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
