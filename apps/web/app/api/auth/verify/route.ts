import { prisma } from "@ryadom/db";
import { normalizePhone, OtpCodeSchema } from "@ryadom/shared";
import { cookies } from "next/headers";
import { fail, readJson } from "@/lib/server/http";
import { nextPath } from "@/lib/server/onboarding";
import { verifyLoginCode } from "@/lib/server/otp";
import { getSession, startSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Шаг 2 входа: проверить код, создать сессию и сказать, куда идти дальше. */
export async function POST(req: Request) {
  const body = (await readJson(req)) as { phone?: unknown; code?: unknown } | null;
  const phone = typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const code = OtpCodeSchema.safeParse(body?.code);
  if (!phone || !code.success) return fail(400, "invalid_code");

  const res = await verifyLoginCode(phone, code.data);
  if (!res.ok) return fail(res.error === "invalid" ? 400 : 410, res.error);

  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, locale: true },
  });
  await startSession(user ? { userId: user.id } : { phone });
  if (user) (await cookies()).set("locale", user.locale, { path: "/", maxAge: 365 * 24 * 3600 });

  return Response.json({ ok: true, next: await nextPath(await getSession()) });
}
