import { GiftAcceptSchema } from "@ryadom/shared";
import { acceptGift } from "@/lib/server/gifts";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Принять подарок: «Заберу у стойки» или «Пусть принесут» за столик. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = GiftAcceptSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_table");
  const res = await acceptGift(session.user.id, (await params).id, body.data);
  if (!res.ok) return fail(res.error === "not_here" ? 409 : 404, res.error);
  return Response.json({ ok: true });
}
