import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { markNoticesRead } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Отметить анонимные уведомления прочитанными. */
export async function POST() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  await markNoticesRead(session.user.id);
  return Response.json({ ok: true });
}
