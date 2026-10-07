import { fail } from "@/lib/server/http";
import { plusState } from "@/lib/server/plus";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Плюс»: статус, суперприветы, буст и цены для страны пользователя. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  return Response.json(await plusState(session.user.id));
}
