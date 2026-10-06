import { rateLimit } from "@/lib/rate-limit";
import { locate, PositionSchema } from "@/lib/server/checkin";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Я здесь»: по точке и её точности найти заведения вокруг. Точка нигде не сохраняется. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const limited = await rateLimit("checkin-locate", session.user.id, 30, 10 * 60);
  if (!limited.ok) return fail(429, "rate_limited", { retryAfterSec: limited.retryAfterSec });

  const pos = PositionSchema.safeParse(await readJson(req));
  if (!pos.success) return fail(400, "invalid_position");

  const res = await locate(session.user.id, pos.data);
  if (!res.ok) return fail(422, res.error);
  return Response.json({ venues: res.venues });
}
