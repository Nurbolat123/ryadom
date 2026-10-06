import { ReportInputSchema } from "@ryadom/shared";
import { fail, readJson } from "@/lib/server/http";
import { reportUser } from "@/lib/server/safety";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Пожаловаться (и по умолчанию сразу заблокировать). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = ReportInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_report");
  const res = await reportUser(session.user.id, (await params).id, body.data);
  if (!res.ok) return fail(res.error === "rate_limited" ? 429 : 404, res.error);
  return Response.json({ ok: true }, { status: 201 });
}
