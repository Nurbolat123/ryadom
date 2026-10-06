import { prisma } from "@ryadom/db";
import { LocaleSchema } from "@ryadom/shared";
import { cookies } from "next/headers";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

/** Сменить язык интерфейса (cookie + профиль, если человек вошёл). */
export async function POST(req: Request) {
  const body = (await readJson(req)) as { locale?: unknown } | null;
  const locale = LocaleSchema.safeParse(body?.locale);
  if (!locale.success) return fail(400, "invalid_locale");
  (await cookies()).set("locale", locale.data, {
    path: "/",
    maxAge: 365 * 24 * 3600,
    sameSite: "lax",
  });
  const session = await getSession();
  if (session?.user) {
    await prisma.user.update({ where: { id: session.user.id }, data: { locale: locale.data } });
  }
  return Response.json({ ok: true });
}
