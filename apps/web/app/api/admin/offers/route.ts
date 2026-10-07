import { OfferInputSchema } from "@ryadom/shared";
import { getAdmin } from "@/lib/server/admin";
import { createOffer, listOffers } from "@/lib/server/admin-places";
import { fail, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Предложения заведений: список (не-модератору — 404). */
export async function GET() {
  if (!(await getAdmin())) return fail(404, "not_found");
  return Response.json({ offers: await listOffers() });
}

/** Добавить предложение — оно попадает на модерацию. */
export async function POST(req: Request) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const body = OfferInputSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_offer");
  const res = await createOffer(body.data);
  if (!res.ok) return fail(404, res.error);
  return Response.json({ id: res.id }, { status: 201 });
}
