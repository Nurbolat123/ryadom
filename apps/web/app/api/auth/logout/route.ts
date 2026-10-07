import { PushEndpointSchema } from "@ryadom/shared";
import { readJson } from "@/lib/server/http";
import { unsubscribePush } from "@/lib/server/push";
import { endSession, getSession } from "@/lib/server/session";

/** Выход. Если браузер прислал адрес своей push-подписки — она удаляется: уведомления больше не придут. */
export async function POST(req: Request) {
  const session = await getSession();
  const body = PushEndpointSchema.safeParse(await readJson(req));
  if (session?.user && body.success) await unsubscribePush(session.user.id, body.data.endpoint);
  await endSession();
  return Response.json({ ok: true });
}
