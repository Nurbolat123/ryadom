import { VenueCreateSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { CITY_OPTIONS, createVenue, listVenues, type VenueFilter } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const FILTERS: VenueFilter[] = ["all", "partners", "inactive", "manual"];
const STATUS = { outside_cities: 422 } as const;

/** Заведения: поиск по названию, slug и адресу, фильтры. Не-модератору — 404. */
export async function GET(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const url = new URL(req.url);
  const city = url.searchParams.get("city");
  const filter = url.searchParams.get("filter") as VenueFilter | null;
  const page = Math.max(0, Math.min(1000, Number(url.searchParams.get("page")) || 0));
  const res = await listVenues({
    city: CITY_OPTIONS.find((c) => c.name === city)?.name ?? null,
    q: (url.searchParams.get("q") ?? "").trim().slice(0, 80),
    filter: filter && FILTERS.includes(filter) ? filter : "all",
    page,
  });
  return Response.json({ ...res, cities: CITY_OPTIONS });
}

/** Добавить заведение вручную: геозона — круг 35 м вокруг точки, город — по точке. */
export async function POST(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = VenueCreateSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_venue_form");
  const res = await createVenue(body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ id: res.id, slug: res.slug }, { status: 201 });
}
