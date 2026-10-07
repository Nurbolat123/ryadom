import { VenueUpdateSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { getVenue, updateVenue } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Заведение целиком: настройки, геозона, меню. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const venue = await getVenue((await params).id);
  if (!venue) return fail(404, "not_found");
  return Response.json({ venue });
}

/** Название, категория, адрес, активно, партнёр, комиссия, максимум подарка. */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = VenueUpdateSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_venue_form");
  const res = await updateVenue((await params).id, body.data);
  if (!res.ok) return fail(404, res.error);
  return Response.json({ ok: true });
}
