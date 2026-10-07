import { prisma } from "@ryadom/db";
import { ProfileUpdateSchema } from "@ryadom/shared";
import { z } from "zod";
import { deleteAccount, updateProfile } from "@/lib/server/account";
import { fail, readJson } from "@/lib/server/http";
import { nextStep } from "@/lib/server/onboarding";
import { endSession, getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Свой профиль. Телефон наружу не отдаём даже владельцу — он ему и так известен. */
export async function GET() {
  const session = await getSession();
  if (!session) return fail(401, "unauthorized");
  const step = await nextStep(session.user);
  if (!session.user) return Response.json({ user: null, step });

  const u = session.user;
  const interests = await prisma.userInterest.findMany({
    where: { userId: u.id },
    select: { interestId: true },
  });
  return Response.json({
    step,
    user: {
      id: u.id,
      displayName: u.displayName,
      gender: u.gender,
      birthDate: u.birthDate.toISOString().slice(0, 10),
      about: u.about,
      hasPhoto: !!u.photo,
      verified: !!u.verifiedAt,
      locale: u.locale,
      adsConsent: u.adsConsent,
      interestIds: interests.map((i) => i.interestId),
    },
  });
}

/** Правка профиля: имя, «о себе», согласие на предложения по интересам. */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = ProfileUpdateSchema.safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_profile");
  return Response.json({ user: await updateProfile(session.user.id, body.data) });
}

/** Удалить аккаунт полностью. Нужно явное подтверждение в теле запроса. */
export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ confirm: z.literal(true) }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "confirm_required");
  const userId = session.user.id;
  await endSession();
  await deleteAccount(userId);
  return Response.json({ ok: true });
}
