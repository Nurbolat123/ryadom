import { prisma } from "@ryadom/db";
import { ageOn, todayIn } from "@ryadom/shared";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ProfileView } from "@/components/ProfileView";
import { Screen } from "@/components/Screen";
import { nextPath } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Профиль: фото, имя, «о себе», интересы, язык, уведомления, согласия, выход, удаление. */
export default async function ProfilePage() {
  const session = await getSession();
  const path = await nextPath(session);
  if (path !== "/home") redirect(path);
  const user = session!.user!;
  const locale = await getLocale();
  const interests = await prisma.userInterest.findMany({
    where: { userId: user.id },
    select: { interest: { select: { nameRu: true, nameKk: true, sortOrder: true } } },
    orderBy: { interest: { sortOrder: "asc" } },
  });
  return (
    <Screen nav>
      <ProfileView
        user={{
          displayName: user.displayName,
          about: user.about ?? "",
          age: ageOn(user.birthDate.toISOString().slice(0, 10), todayIn()),
          adsConsent: user.adsConsent,
          isAdmin: user.role === "admin",
        }}
        interests={interests.map((i) => (locale === "kk" ? i.interest.nameKk : i.interest.nameRu))}
      />
    </Screen>
  );
}
