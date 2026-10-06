import { getLocale } from "next-intl/server";
import { listGifts } from "@/lib/server/gifts";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Полученные подарки и отправленные (с нейтральным статусом). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  return Response.json(await listGifts(session.user.id, locale));
}
