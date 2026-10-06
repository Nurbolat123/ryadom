import { getLocale } from "next-intl/server";
import { fail } from "@/lib/server/http";
import { listPeople } from "@/lib/server/people";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Люди в заведении, где ты сейчас отмечен(а). */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  const res = await listPeople(session.user.id, locale);
  if (!res.ok) return fail(403, res.error);
  return Response.json({ open: res.open, people: res.people });
}
