import { PurchaseInputSchema } from "@ryadom/shared";
import { fail, readJson } from "@/lib/server/http";
import { buyProduct } from "@/lib/server/plus";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const STATUS = {
  invalid_product: 400,
  auto_renew_unavailable: 400,
  rate_limited: 429,
  payment_failed: 402,
} as const;

/** Купить «Плюс» или суперприветы. Автопродление — только явной галочкой. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = PurchaseInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_product");
  const res = await buyProduct(session.user.id, body.data);
  if (!res.ok) return fail(STATUS[res.error], res.error);
  if (res.status === "redirect")
    return Response.json(
      { redirectUrl: res.redirectUrl, purchaseId: res.purchaseId },
      { status: 202 },
    );
  return Response.json({ purchaseId: res.purchaseId }, { status: 201 });
}
