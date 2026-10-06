import { prisma } from "@ryadom/db";
import { VenueCategory } from "@ryadom/shared";
import { CITIES, OverpassVenueSource } from "@ryadom/venues";
import { z } from "zod";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  city: z.enum(Object.keys(CITIES) as [string, ...string[]]),
  category: z.enum(VenueCategory).optional(),
  q: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Список активных заведений города (для «Где знакомятся сейчас» и поиска).
 * Без координат и геозон (правило 4); ссылка на источник данных обязательна (ODbL).
 */
export async function GET(req: Request) {
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const parsed = QuerySchema.safeParse(params);
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const { city, category, q, limit } = parsed.data;

  const venues = await prisma.venue.findMany({
    where: {
      city: CITIES[city as keyof typeof CITIES].name,
      isActive: true,
      ...(category ? { category } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      address: true,
      city: true,
      isPartner: true,
      source: true,
    },
    orderBy: [{ isPartner: "desc" }, { name: "asc" }],
    take: limit,
  });

  return Response.json({
    venues: venues.map(({ source, ...v }) => ({ ...v, fromOsm: source === "osm" })),
    attribution: new OverpassVenueSource().attribution,
  });
}
