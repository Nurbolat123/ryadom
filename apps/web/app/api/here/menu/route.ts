import { getLocale } from "next-intl/server";
import { giftMenu } from "@/lib/server/gifts";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** «Угостить»: меню заведения-партнёра, где ты сейчас. Только giftable, без алкоголя. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  const res = await giftMenu(session.user.id, locale);
  if (!res.ok) return fail(res.error === "not_partner" ? 404 : 403, res.error);
  return Response.json(res.menu);
}
