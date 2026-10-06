import { GiftInputSchema } from "@ryadom/shared";
import { sendGift } from "@/lib/server/gifts";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const STATUS = {
  not_found: 404,
  not_partner: 404,
  item_unavailable: 409,
  gift_already_sent: 409,
  gift_daily_limit: 429,
  rate_limited: 429,
  payment_failed: 402,
} as const;

/** Угостить: оплата сразу, при отказе или через 2 часа без ответа — возврат. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = GiftInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_gift");
  const res = await sendGift(session.user.id, (await params).id, body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  return Response.json({ giftId: res.giftId }, { status: 201 });
}
