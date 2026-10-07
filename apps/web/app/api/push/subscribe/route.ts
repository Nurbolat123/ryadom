import { PushEndpointSchema, PushSubscriptionSchema } from "@ryadom/shared";
import { fail, readJson } from "@/lib/server/http";
import { subscribePush, unsubscribePush } from "@/lib/server/push";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const STATUS = { push_unavailable: 503, rate_limited: 429 } as const;

/** Включить уведомления в этом браузере. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = PushSubscriptionSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_subscription");
  const res = await subscribePush(session.user.id, body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ ok: true }, { status: 201 });
}

/** Выключить уведомления в этом браузере. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = PushEndpointSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_subscription");
  await unsubscribePush(session.user.id, body.data.endpoint);
  return Response.json({ ok: true });
}
