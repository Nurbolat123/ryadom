import { GeofenceInputSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { releaseGeofence, setGeofence } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const STATUS = { not_found: 404, outside_city: 422, no_import: 409 } as const;

/** Ручная геозона-круг: точка и радиус. Импорт её больше не перезапишет. */
export async function PUT(req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = GeofenceInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_geofence");
  const res = await setGeofence((await params).id, body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true });
}

/** Вернуть геозону импорту из OSM (контур здания или круг 35 м при следующем импорте). */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const res = await releaseGeofence((await params).id);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true });
}
