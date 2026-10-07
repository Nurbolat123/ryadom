import { getAdmin } from "@/lib/server/admin";
import { partnersReport } from "@/lib/server/admin-places";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Отчёт для партнёров за 30 дней: показы, переходы, коды, погашения, чек-ины. */
export async function GET() {
  if (!(await getAdmin())) return fail(404, "not_found");
  return Response.json({ days: 30, venues: await partnersReport(30) });
}
