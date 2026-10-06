import { deactivateMissingVenues, upsertSourceVenue, type PrismaClient } from "@ryadom/db";
import type { VenueCategory } from "@ryadom/shared";
import type { CityConfig } from "./cities";
import { uniqueSlug } from "./slug";
import type { VenueSource } from "./source";

export type ImportReport = {
  runId: string;
  city: string;
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  /** Деактивация пропущена: источник вернул подозрительно мало мест. */
  deactivationSkipped: boolean;
  byCategory: Partial<Record<VenueCategory, number>>;
  geofences: { building: number; circle: number; manual: number };
  activeTotal: number;
};

/**
 * Если источник вернул меньше этой доли от уже активных мест города, считаем ответ неполным
 * (сбой Overpass, обрезанный ответ) и никого не деактивируем.
 */
export const MIN_SHARE_TO_DEACTIVATE = 0.5;

/**
 * Импорт заведений города из источника: новые добавляются, существующие обновляются,
 * пропавшие помечаются неактивными (не удаляются). Ход записывается в VenueImportRun.
 */
export const importVenues = async (
  db: PrismaClient,
  source: VenueSource,
  city: CityConfig,
  { now = new Date() }: { now?: Date } = {},
): Promise<ImportReport> => {
  const run = await db.venueImportRun.create({ data: { source: source.kind, city: city.name } });
  try {
    const venues = await source.fetchVenues(city);

    const activeBefore = await db.venue.count({
      where: { source: source.kind, city: city.name, isActive: true },
    });
    const existing = await db.venue.findMany({
      where: { source: source.kind },
      select: { sourceId: true, slug: true },
    });
    const slugBySourceId = new Map(existing.map((v) => [v.sourceId, v.slug]));
    const taken = new Set((await db.venue.findMany({ select: { slug: true } })).map((v) => v.slug));

    const report: ImportReport = {
      runId: run.id,
      city: city.name,
      fetched: venues.length,
      created: 0,
      updated: 0,
      deactivated: 0,
      deactivationSkipped: false,
      byCategory: {},
      geofences: { building: 0, circle: 0, manual: 0 },
      activeTotal: 0,
    };

    for (const v of venues) {
      const slug = slugBySourceId.get(v.sourceId) ?? uniqueSlug(v.name, taken, v.category);
      const res = await upsertSourceVenue(db, {
        source: source.kind,
        sourceId: v.sourceId,
        slug,
        name: v.name,
        category: v.category,
        address: v.address,
        city: city.name,
        timezone: city.timezone,
        location: v.location,
        footprint: v.footprint,
        seenAt: now,
      });
      if (res.inserted) report.created++;
      else report.updated++;
      report.geofences[res.geofenceKind]++;
      report.byCategory[v.category] = (report.byCategory[v.category] ?? 0) + 1;
    }

    if (activeBefore > 0 && venues.length < activeBefore * MIN_SHARE_TO_DEACTIVATE) {
      report.deactivationSkipped = true;
    } else {
      report.deactivated = await deactivateMissingVenues(db, source.kind, city.name, now);
    }

    report.activeTotal = await db.venue.count({ where: { city: city.name, isActive: true } });

    await db.venueImportRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        fetched: report.fetched,
        created: report.created,
        updated: report.updated,
        deactivated: report.deactivated,
        error: report.deactivationSkipped
          ? `Источник вернул ${venues.length} мест при ${activeBefore} активных — деактивация пропущена`
          : null,
      },
    });
    return report;
  } catch (error) {
    await db.venueImportRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
};
