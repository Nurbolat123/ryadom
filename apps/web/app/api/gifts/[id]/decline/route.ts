import { declineGift } from "@/lib/server/gifts";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Не принимать»: отправитель не узнаёт (правило 7), деньги ему возвращаются. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  if (!(await declineGift(session.user.id, (await params).id))) return fail(404, "not_found");
  return Response.json({ ok: true });
}
