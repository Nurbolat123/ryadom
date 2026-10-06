import { ChatMessageSchema } from "@ryadom/shared";
import { z } from "zod";
import { sendMessage } from "@/lib/server/chat";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ body: ChatMessageSchema }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_message");
  const res = await sendMessage(session.user.id, (await params).id, body.data.body);
  if (!res.ok) return fail(res.error === "rate_limited" ? 429 : 404, res.error);
  return Response.json({ message: res.message }, { status: 201 });
}
