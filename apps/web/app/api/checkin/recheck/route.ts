import { PositionSchema, recheck } from "@/lib/server/checkin";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Перепроверка положения при повторном открытии приложения. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const pos = PositionSchema.safeParse(await readJson(req));
  if (!pos.success) return fail(400, "invalid_position");
  return Response.json(await recheck(session.user.id, pos.data));
}
