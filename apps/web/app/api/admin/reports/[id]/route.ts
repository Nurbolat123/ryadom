import { MODERATION_ACTIONS } from "@ryadom/shared";
import { z } from "zod";
import { getAdmin } from "@/lib/server/admin";
import { fail, readJson } from "@/lib/server/http";
import { resolveReport } from "@/lib/server/safety";

export const dynamic = "force-dynamic";

/** Решение по жалобе: отклонить, снять фото или заблокировать аккаунт. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getAdmin();
  if (!admin) return fail(404, "not_found");
  const body = z.object({ action: z.enum(MODERATION_ACTIONS) }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_request");
  if (!(await resolveReport(admin.id, (await params).id, body.data.action)))
    return fail(404, "not_found");
  return Response.json({ ok: true });
}
