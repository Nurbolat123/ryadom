import { createManualVenue, type PrismaClient } from "@ryadom/db";
import { VenueCategory } from "@ryadom/shared";
import { z } from "zod";
import { CITIES, getCity } from "./cities";
import { uniqueSlug } from "./slug";

/**
 * «Нет моего заведения». Пользователь присылает название и адрес.
 * Координаты пользователя сюда не передаются и не сохраняются (правило 4):
 * точку заведения ставит модератор при одобрении.
 */
export const VenueSuggestionInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    city: z.enum(Object.keys(CITIES) as [string, ...string[]]),
    category: z.enum(VenueCategory).optional(),
    address: z.string().trim().max(200).optional(),
    comment: z.string().trim().max(300).optional(),
  })
  .strict();
export type VenueSuggestionInput = z.infer<typeof VenueSuggestionInputSchema>;

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Создать предложение. Повтор того же места в том же городе, пока оно на проверке, не плодит дублей. */
export const createVenueSuggestion = async (
  db: PrismaClient,
  input: VenueSuggestionInput,
  userId: string | null,
): Promise<{ id: string; duplicate: boolean }> => {
  const city = getCity(input.city);
  const pending = await db.venueSuggestion.findMany({
    where: { city: city.name, status: "pending" },
    select: { id: true, name: true },
  });
  const same = pending.find((p) => norm(p.name) === norm(input.name));
  if (same) return { id: same.id, duplicate: true };

  const created = await db.venueSuggestion.create({
    data: {
      userId,
      name: input.name,
      city: city.name,
      category: input.category ?? null,
      address: input.address || null,
      comment: input.comment || null,
    },
    select: { id: true },
  });
  return { id: created.id, duplicate: false };
};

export const ApproveSuggestionSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  category: z.enum(VenueCategory).optional(),
  name: z.string().trim().min(2).max(80).optional(),
});

/** Одобрить: создаётся заведение с ручной геозоной-кругом 35 м вокруг точки модератора. */
export const approveVenueSuggestion = async (
  db: PrismaClient,
  suggestionId: string,
  input: z.infer<typeof ApproveSuggestionSchema>,
): Promise<{ venueId: string; slug: string }> => {
  const data = ApproveSuggestionSchema.parse(input);
  const s = await db.venueSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
  if (s.status !== "pending") throw new Error(`Предложение уже рассмотрено (${s.status})`);
  const category = data.category ?? s.category;
  if (!category) throw new Error("Укажите категорию заведения (--category)");

  const city = Object.values(CITIES).find((c) => c.name === s.city);
  const [south, west, north, east] = city?.bbox ?? [-90, -180, 90, 180];
  if (data.lat < south || data.lat > north || data.lng < west || data.lng > east) {
    throw new Error(`Точка вне города ${s.city}`);
  }

  const taken = new Set((await db.venue.findMany({ select: { slug: true } })).map((v) => v.slug));
  const name = data.name ?? s.name;
  const slug = uniqueSlug(name, taken, category);

  return db.$transaction(async (tx) => {
    const venueId = await createManualVenue(tx, {
      slug,
      name,
      category,
      address: s.address,
      city: s.city,
      timezone: city?.timezone ?? "Asia/Almaty",
      source: "user",
      location: [data.lng, data.lat],
    });
    await tx.venueSuggestion.update({
      where: { id: s.id },
      data: { status: "approved", venueId, reviewedAt: new Date() },
    });
    return { venueId, slug };
  });
};

export const rejectVenueSuggestion = async (db: PrismaClient, suggestionId: string) => {
  const s = await db.venueSuggestion.findUniqueOrThrow({ where: { id: suggestionId } });
  if (s.status !== "pending") throw new Error(`Предложение уже рассмотрено (${s.status})`);
  await db.venueSuggestion.update({
    where: { id: suggestionId },
    data: { status: "rejected", reviewedAt: new Date() },
  });
};
