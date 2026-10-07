import { PlacesQuerySchema } from "@ryadom/shared";
import { getLocale } from "next-intl/server";
import { offerAudience } from "@/lib/server/ads";
import { fail, readJson } from "@/lib/server/http";
import { listPlaces } from "@/lib/server/places";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * «Где знакомятся сейчас» — открыто без входа (видно с приветственного экрана).
 * POST, а не GET: точка человека для сортировки «Рядом» не должна попадать в адрес и логи.
 */
export async function POST(req: Request) {
  if (!(await rateLimit("places", clientIp(req), 600, 3600)).ok) return fail(429, "rate_limited");
  const body = PlacesQuerySchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "bad_request");
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  return Response.json(await listPlaces(body.data, locale, await offerAudience()));
}
