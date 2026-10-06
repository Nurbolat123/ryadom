import { fail } from "@/lib/server/http";
import { blockUser } from "@/lib/server/safety";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Заблокировать: бесплатно, мгновенно и навсегда (правило 9). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  if (!(await blockUser(session.user.id, (await params).id))) return fail(404, "not_found");
  return Response.json({ ok: true });
}
