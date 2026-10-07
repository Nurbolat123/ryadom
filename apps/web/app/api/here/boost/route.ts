import { fail } from "@/lib/server/http";
import { startBoost } from "@/lib/server/plus";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const STATUS = { not_checked_in: 403, no_plus: 402, boost_used: 409 } as const;

/** Буст видимости на час в текущем заведении (с «Плюс», раз за визит). */
export async function POST() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const res = await startBoost(session.user.id);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ until: res.until });
}
