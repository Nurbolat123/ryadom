import { z } from "zod";
import { getAdmin } from "@/lib/server/admin";
import { CITY_OPTIONS, listImports, startImport } from "@/lib/server/admin-venues";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const STATUS = { bad_city: 400, import_running: 409 } as const;

/** Журнал импортов из OpenStreetMap (последние 20). */
export async function GET() {
  if (!(await getAdmin())) return fail(404, "not_found");
  return Response.json({ runs: await listImports(), cities: CITY_OPTIONS });
}

/** Запустить импорт города сейчас (в фоне); итог появится в журнале. */
export async function POST(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = z
    .object({ city: z.string().min(1).max(40) })
    .strict()
    .safeParse(await readJson(req));
  if (!body.success) return fail(400, "bad_request");
  const res = await startImport(body.data.city);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true }, { status: 202 });
}
