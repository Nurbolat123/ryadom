import { listChats } from "@/lib/server/chat";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  return Response.json({ chats: await listChats(session.user.id) });
}
