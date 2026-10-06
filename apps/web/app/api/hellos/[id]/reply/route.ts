import { ChatMessageSchema } from "@ryadom/shared";
import { z } from "zod";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { replyToHello } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Ответить на привет — открывается чат. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ message: ChatMessageSchema }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_message");
  const res = await replyToHello(session.user.id, (await params).id, body.data.message);
  if (!res.ok) return fail(404, res.error);
  return Response.json({ chatId: res.chatId });
}
