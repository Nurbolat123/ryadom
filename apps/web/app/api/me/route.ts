import { prisma } from "@ryadom/db";
import { fail } from "@/lib/server/http";
import { nextStep } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

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
      interestIds: interests.map((i) => i.interestId),
    },
  });
}
