import { getAdmin } from "@/lib/server/admin";
import { giftReport } from "@/lib/server/gift-report";
import { fail } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Отчёт по подаркам и комиссии за 30 дней. Не-модератору — 404. */
export async function GET() {
  if (!(await getAdmin())) return fail(404, "not_found");
  return Response.json({ days: 30, venues: await giftReport(30) });
}
