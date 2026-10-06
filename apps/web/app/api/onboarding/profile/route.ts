import { prisma } from "@ryadom/db";
import { isAdult, ProfileInputSchema } from "@ryadom/shared";
import { cookies } from "next/headers";
import { blockUnderage, isUnderageBlocked } from "@/lib/server/age-block";
import { fail, readJson } from "@/lib/server/http";
import { pathForStep } from "@/lib/server/onboarding";
import { attachUserToSession, getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Создать пользователя: дата рождения (повторная проверка 18+), пол, имя. */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.phone) return fail(401, "no_signup_session");
  if (await isUnderageBlocked(session.phone)) return fail(403, "underage");

  const parsed = ProfileInputSchema.safeParse(await readJson(req));
  if (!parsed.success) {
    return fail(400, "invalid_profile", {
      fields: Object.keys(parsed.error.flatten().fieldErrors),
    });
  }
  const { birthDate, gender, displayName } = parsed.data;
  if (!isAdult(birthDate)) {
    await blockUnderage(session.phone);
    return fail(403, "underage");
  }

  const locale = (await cookies()).get("locale")?.value === "kk" ? "kk" : "ru";
  const user = await prisma.user.upsert({
    where: { phone: session.phone },
    create: {
      phone: session.phone,
      birthDate: new Date(`${birthDate}T00:00:00Z`),
      gender,
      displayName,
      locale,
      countryCode: "KZ",
    },
    update: {},
  });
  await attachUserToSession(session.id, user.id);
  return Response.json({ ok: true, next: pathForStep("photo") }, { status: 201 });
}
