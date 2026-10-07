import { fail } from "@/lib/server/http";
import { pushPublicKey } from "@/lib/server/push";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Публичный VAPID-ключ для подписки браузера; null — push не настроен. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  return Response.json({ publicKey: pushPublicKey() });
}
