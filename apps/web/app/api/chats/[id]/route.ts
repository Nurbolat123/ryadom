import { getChat } from "@/lib/server/chat";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Сообщения чата; заодно отмечает входящие прочитанными. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const chat = await getChat(session.user.id, (await params).id);
  if (!chat) return fail(404, "not_found");
  return Response.json({ chat });
}
