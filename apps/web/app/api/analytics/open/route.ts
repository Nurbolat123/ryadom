import { track } from "@/lib/server/analytics";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Воронка: приложение открыто (раз за сессию вкладки). Обезличенно: ни пользователя, ни IP. */
export async function POST(req: Request) {
  if ((await rateLimit("app-open", clientIp(req), 60, 3600)).ok) await track("app_open", null);
  return new Response(null, { status: 204 });
}
