import { getAdmin } from "@/lib/server/admin";
import { FUNNEL_STEPS, funnel } from "@/lib/server/admin-places";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Воронка по заведению и дню за 7, 14 или 30 дней. */
export async function GET(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const d = Number(new URL(req.url).searchParams.get("days"));
  const days = [7, 14, 30].includes(d) ? d : 14;
  return Response.json({ days, steps: FUNNEL_STEPS, rows: await funnel(days) });
}
