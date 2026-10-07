import { PushEndpointSchema } from "@ryadom/shared";
import { fail, readJson } from "@/lib/server/http";
import { hasPushSubscription } from "@/lib/server/push";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Подписан ли этот браузер на уведомления этого аккаунта (подписка могла перейти к другому). */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = PushEndpointSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_subscription");
  return Response.json({
    subscribed: await hasPushSubscription(session.user.id, body.data.endpoint),
  });
}
