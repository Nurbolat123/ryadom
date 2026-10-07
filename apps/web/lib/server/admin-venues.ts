import {
  createManualVenue,
  getVenueGeometry,
  prisma,
  setVenueManualCircle,
  type Prisma,
} from "@ryadom/db";
import { createLinkCode, LINK_TTL_SECONDS } from "@ryadom/gifts";
import { listPresent, publishUserEvent } from "@ryadom/presence";
import {
  fromMinor,
  toMinor,
  type GeofenceInputSchema,
  type MenuItemInputSchema,
  type VenueCategory,
  type VenueCreateSchema,
  type VenueUpdateSchema,
} from "@ryadom/shared";
import {
  approveVenueSuggestion,
  CITIES,
  importVenues,
  OverpassVenueSource,
  rejectVenueSuggestion,
  uniqueSlug,
  type CityConfig,
  type VenueSource,
} from "@ryadom/venues";
import type { z } from "zod";
import { redis } from "../redis";
import { leave } from "./checkin";
import { defaultCommissionPct, defaultMaxAmount } from "./gifts";

/**
 * Админка заведений: список, правка, партнёры, геозоны, меню, импорт, «Нет моего заведения».
 * Только для модератора. Координаты здесь — точки заведений, а не людей.
 */

const PAGE = 50;

export type VenueFilter = "all" | "partners" | "inactive" | "manual";

export const listVenues = async ({
  city,
  q,
  filter,
  page,
}: {
  city: string | null;
  q: string;
  filter: VenueFilter;
  page: number;
}) => {
  const where: Prisma.VenueWhereInput = {
    ...(city ? { city } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            { address: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filter === "partners" ? { isPartner: true } : {}),
    ...(filter === "inactive" ? { isActive: false } : {}),
    ...(filter === "manual" ? { geofenceKind: "manual" } : {}),
  };
  const [total, venues] = await Promise.all([
    prisma.venue.count({ where }),
    prisma.venue.findMany({
      where,
      orderBy: [{ isPartner: "desc" }, { isActive: "desc" }, { name: "asc" }],
      skip: page * PAGE,
      take: PAGE,
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        address: true,
        city: true,
        isActive: true,
        isPartner: true,
        geofenceKind: true,
        source: true,
        telegramChatId: true,
        _count: { select: { menuItems: true } },
      },
    }),
  ]);
  return {
    total,
    pageSize: PAGE,
    venues: venues.map(({ _count, telegramChatId, ...v }) => ({
      ...v,
      menuItems: _count.menuItems,
      telegramLinked: telegramChatId !== null,
    })),
  };
};

const menuView = (m: {
  id: string;
  name: string;
  nameKk: string | null;
  price: number;
  isAlcohol: boolean;
  giftable: boolean;
  isAvailable: boolean;
  sortOrder: number;
}) => ({
  id: m.id,
  name: m.name,
  nameKk: m.nameKk,
  price: fromMinor(m.price),
  isAlcohol: m.isAlcohol,
  giftable: m.giftable,
  isAvailable: m.isAvailable,
  sortOrder: m.sortOrder,
});

export const getVenue = async (id: string) => {
  const v = await prisma.venue.findUnique({
    where: { id },
    include: { menuItems: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
  });
  if (!v) return null;
  const geometry = await getVenueGeometry(prisma, id);
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    category: v.category,
    address: v.address,
    city: v.city,
    source: v.source,
    sourceId: v.sourceId,
    isActive: v.isActive,
    isPartner: v.isPartner,
    geofenceKind: v.geofenceKind,
    telegramLinked: v.telegramChatId !== null,
    commissionPct: v.commissionPct === null ? null : Number(v.commissionPct),
    maxGiftAmount: v.maxGiftAmount === null ? null : fromMinor(v.maxGiftAmount),
    defaults: {
      commissionPct: defaultCommissionPct(),
      maxGiftAmount: fromMinor(defaultMaxAmount()),
    },
    currency: v.currency,
    geometry,
    menu: v.menuItems.map(menuView),
  };
};

/** Всех, кто отмечен в заведении, снять с отметки (заведение закрыто модератором). */
const clearVenuePresence = async (venueId: string) => {
  for (const userId of await listPresent(redis, venueId)) {
    await leave(userId);
    await publishUserEvent(redis, { type: "refresh", userId });
  }
};

export const updateVenue = async (id: string, input: z.infer<typeof VenueUpdateSchema>) => {
  const before = await prisma.venue.findUnique({ where: { id }, select: { isActive: true } });
  if (!before) return { ok: false as const, error: "not_found" as const };
  const { maxGiftAmount, ...rest } = input;
  await prisma.venue.update({
    where: { id },
    data: {
      ...rest,
      ...(maxGiftAmount !== undefined
        ? { maxGiftAmount: maxGiftAmount === null ? null : toMinor(maxGiftAmount) }
        : {}),
    },
  });
  if (before.isActive && input.isActive === false) await clearVenuePresence(id);
  return { ok: true as const };
};

const cityOf = (name: string): CityConfig | undefined =>
  Object.values(CITIES).find((c) => c.name === name || c.slug === name);

const insideCity = (city: CityConfig | undefined, lat: number, lng: number) => {
  if (!city) return true;
  const [south, west, north, east] = city.bbox;
  return lat >= south && lat <= north && lng >= west && lng <= east;
};

/** Ручная геозона-круг. Точка — в пределах города заведения. Импорт её больше не трогает. */
export const setGeofence = async (id: string, input: z.infer<typeof GeofenceInputSchema>) => {
  const v = await prisma.venue.findUnique({ where: { id }, select: { city: true } });
  if (!v) return { ok: false as const, error: "not_found" as const };
  if (!insideCity(cityOf(v.city), input.lat, input.lng))
    return { ok: false as const, error: "outside_city" as const };
  await setVenueManualCircle(prisma, id, [input.lng, input.lat], input.radiusM);
  return { ok: true as const };
};

/**
 * Вернуть геозону импорту: при следующем импорте из OSM она снова станет контуром здания
 * или кругом 35 м. Только для мест из OSM — у остальных импорта нет.
 */
export const releaseGeofence = async (id: string) => {
  const v = await prisma.venue.findUnique({ where: { id }, select: { source: true } });
  if (!v) return { ok: false as const, error: "not_found" as const };
  if (v.source !== "osm" && v.source !== "dgis")
    return { ok: false as const, error: "no_import" as const };
  await prisma.venue.update({ where: { id }, data: { geofenceKind: "circle" } });
  return { ok: true as const };
};

/** Город заведения — тот, в границы которого попадает точка. */
export const createVenue = async (input: z.infer<typeof VenueCreateSchema>) => {
  const city = Object.values(CITIES).find((c) => insideCity(c, input.lat, input.lng));
  if (!city) return { ok: false as const, error: "outside_cities" as const };
  const taken = new Set(
    (await prisma.venue.findMany({ select: { slug: true } })).map((v) => v.slug),
  );
  const slug = uniqueSlug(input.name, taken, input.category);
  const id = await createManualVenue(prisma, {
    slug,
    name: input.name,
    category: input.category,
    address: input.address || null,
    city: city.name,
    timezone: city.timezone,
    source: "admin",
    location: [input.lng, input.lat],
  });
  return { ok: true as const, id, slug };
};

/** Одноразовый код для `/link КОД` в чате персонала (тот же, что `pnpm bot:link`). */
export const staffLinkCode = async (id: string) => {
  const v = await prisma.venue.findUnique({ where: { id }, select: { id: true } });
  if (!v) return null;
  return { code: await createLinkCode(redis, v.id), ttlMinutes: LINK_TTL_SECONDS / 60 };
};

/** Отвязать чат персонала: заказы туда больше не уходят. */
export const unlinkStaffChat = async (id: string) => {
  const res = await prisma.venue.updateMany({ where: { id }, data: { telegramChatId: null } });
  return res.count > 0;
};

// ───────────── Меню ─────────────

type MenuInput = z.infer<typeof MenuItemInputSchema>;

const menuData = (m: MenuInput) => ({
  name: m.name,
  nameKk: m.nameKk || null,
  price: toMinor(m.price),
  isAlcohol: m.isAlcohol,
  // Правило 8: алкоголь никогда не бывает подарком (ещё и CHECK в базе).
  giftable: m.giftable && !m.isAlcohol,
  isAvailable: m.isAvailable,
  ...(m.sortOrder !== undefined ? { sortOrder: m.sortOrder } : {}),
});

export const addMenuItem = async (venueId: string, input: MenuInput) => {
  const v = await prisma.venue.findUnique({ where: { id: venueId }, select: { currency: true } });
  if (!v) return { ok: false as const, error: "not_found" as const };
  const item = await prisma.menuItem.create({
    data: { venueId, currency: v.currency, ...menuData(input) },
  });
  return { ok: true as const, item: menuView(item) };
};

export const updateMenuItem = async (venueId: string, itemId: string, input: MenuInput) => {
  const res = await prisma.menuItem.updateMany({
    where: { id: itemId, venueId },
    data: menuData(input),
  });
  if (res.count === 0) return { ok: false as const, error: "not_found" as const };
  return { ok: true as const };
};

/** Удалить позицию. Если её уже дарили, удалить нельзя (история подарков) — только убрать из наличия. */
export const deleteMenuItem = async (venueId: string, itemId: string) => {
  const item = await prisma.menuItem.findFirst({
    where: { id: itemId, venueId },
    select: { _count: { select: { gifts: true } } },
  });
  if (!item) return { ok: false as const, error: "not_found" as const };
  if (item._count.gifts > 0) return { ok: false as const, error: "menu_item_in_use" as const };
  await prisma.menuItem.delete({ where: { id: itemId } });
  return { ok: true as const };
};

// ───────────── Импорт из OpenStreetMap ─────────────

/** Пока идёт импорт города, второй не запускается. Ключ живёт не дольше 30 минут на случай сбоя. */
const IMPORT_LOCK_SEC = 30 * 60;
const importLock = (city: string) => `venue-import-lock:${city}`;

export const listImports = async () => {
  const runs = await prisma.venueImportRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 });
  // Импорт, который «идёт» дольше замка, прервался вместе с процессом — показываем как сбой.
  const stale = Date.now() - IMPORT_LOCK_SEC * 1000;
  return runs.map((r) => ({
    id: r.id,
    city: r.city,
    status:
      r.status === "running" && r.startedAt.getTime() < stale ? ("failed" as const) : r.status,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    fetched: r.fetched,
    created: r.created,
    updated: r.updated,
    deactivated: r.deactivated,
    error: r.error,
  }));
};

/**
 * Запустить импорт города в фоне (Overpass отвечает десятки секунд).
 * Ход и итог — в VenueImportRun, как у `pnpm venues:import`.
 */
export const startImport = async (
  citySlug: string,
  source: VenueSource = new OverpassVenueSource(),
) => {
  const city = cityOf(citySlug);
  if (!city) return { ok: false as const, error: "bad_city" as const };
  const locked = await redis.set(importLock(city.slug), "1", "EX", IMPORT_LOCK_SEC, "NX");
  if (!locked) return { ok: false as const, error: "import_running" as const };
  const done = importVenues(prisma, source, city)
    .catch((err: unknown) => {
      // Ошибка уже записана в VenueImportRun; здесь — только чтобы процесс не упал.
      console.warn(
        `venues: импорт ${city.slug} не удался:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    })
    .finally(() => redis.del(importLock(city.slug)));
  return { ok: true as const, done };
};

export const CITY_OPTIONS = Object.values(CITIES).map((c) => ({ slug: c.slug, name: c.name }));

// ───────────── «Нет моего заведения» ─────────────

export const listSuggestions = async () => {
  const rows = await prisma.venueSuggestion.findMany({
    where: {
      OR: [{ status: "pending" }, { reviewedAt: { gt: new Date(Date.now() - 30 * 86_400_000) } }],
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 200,
    include: { venue: { select: { id: true, slug: true } } },
  });
  // Кто предложил место, модератору не нужно — userId не отдаётся.
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    city: s.city,
    citySlug: cityOf(s.city)?.slug ?? null,
    category: s.category as VenueCategory | null,
    address: s.address,
    comment: s.comment,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    venueId: s.venue?.id ?? null,
  }));
};

export const approveSuggestion = async (
  id: string,
  input: { lat: number; lng: number; category?: VenueCategory; name?: string },
) => {
  const s = await prisma.venueSuggestion.findUnique({ where: { id } });
  if (!s) return { ok: false as const, error: "not_found" as const };
  if (s.status !== "pending") return { ok: false as const, error: "already_reviewed" as const };
  if (!input.category && !s.category)
    return { ok: false as const, error: "category_required" as const };
  if (!insideCity(cityOf(s.city), input.lat, input.lng))
    return { ok: false as const, error: "outside_city" as const };
  const res = await approveVenueSuggestion(prisma, id, input);
  return { ok: true as const, ...res };
};

export const rejectSuggestion = async (id: string) => {
  const s = await prisma.venueSuggestion.findUnique({ where: { id }, select: { status: true } });
  if (!s) return { ok: false as const, error: "not_found" as const };
  if (s.status !== "pending") return { ok: false as const, error: "already_reviewed" as const };
  await rejectVenueSuggestion(prisma, id);
  return { ok: true as const };
};
