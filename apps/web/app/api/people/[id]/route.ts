import { getLocale } from "next-intl/server";
import { fail } from "@/lib/server/http";
import { personCard } from "@/lib/server/people";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Карточка человека — только если вы оба сейчас в одном заведении и открыты к знакомству. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const { id } = await params;
  const locale = (await getLocale()) === "kk" ? "kk" : "ru";
  const person = await personCard(session.user.id, id, locale);
  // 404, а не 403: не подтверждаем даже существование человека.
  if (!person) return fail(404, "not_found");
  return Response.json({ person });
}
