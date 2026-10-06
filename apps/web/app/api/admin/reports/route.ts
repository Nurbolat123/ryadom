import { getAdmin } from "@/lib/server/admin";
import { fail } from "@/lib/server/http";
import { listReports } from "@/lib/server/safety";

export const dynamic = "force-dynamic";

/** Жалобы для модерации. Не-модератору — 404, чтобы не раскрывать админку. */
export async function GET(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const status =
    new URL(req.url).searchParams.get("status") === "resolved" ? "resolved" : "pending";
  return Response.json({ reports: await listReports(status) });
}
