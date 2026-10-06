import { fail } from "@/lib/server/http";
import { issueRealtimeTicket } from "@/lib/server/realtime-ticket";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Одноразовый билет для подключения к realtime-сервису.
 * Нужен, когда realtime на другом домене и cookie сессии туда не уходит (Codespaces, отдельный поддомен).
 */
export async function POST() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  return Response.json({ ticket: await issueRealtimeTicket(session.user.id) });
}
