import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { removeSympathy, sendSympathy } from "@/lib/server/social";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Поставить сердечко. Ответ: «отправлено» или «взаимно» с id чата. */
export async function POST(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const res = await sendSympathy(session.user.id, (await params).id);
  if (!res.ok) return fail(res.error === "rate_limited" ? 429 : 404, res.error);
  return Response.json(
    res.status === "match" ? { status: "match", chatId: res.chatId } : { status: "sent" },
  );
}

/** Снять сердечко (только до взаимности). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const res = await removeSympathy(session.user.id, (await params).id);
  if (!res.ok) return fail(409, res.error);
  return Response.json({ ok: true });
}
