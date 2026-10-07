import { fail } from "@/lib/server/http";
import { stopAutoRenew } from "@/lib/server/plus";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Отменить автопродление в одно нажатие. «Плюс» действует до конца оплаченного срока. */
export async function DELETE() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  await stopAutoRenew(session.user.id);
  return Response.json({ ok: true });
}
