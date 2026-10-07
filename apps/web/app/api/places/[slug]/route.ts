import { getLocale } from "next-intl/server";
import { offerAudience } from "@/lib/server/ads";
import { fail } from "@/lib/server/http";
import { placeDetails } from "@/lib/server/places";

export const dynamic = "force-dynamic";

/** Заведение: активность диапазоном, популярные часы, предложения. Без людей и координат. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  const place = await placeDetails((await params).slug, locale, await offerAudience());
  if (!place) return fail(404, "not_found");
  return Response.json(place);
}
