import { fail } from "@/lib/server/http";
import { syncPurchase } from "@/lib/server/payments";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Состояние своей покупки — для страницы возврата с оплаты. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const p = await syncPurchase(session.user.id, (await params).id);
  if (!p) return fail(404, "not_found");
  return Response.json(p);
}
