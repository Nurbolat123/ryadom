import { prisma } from "@ryadom/db";
import { RULES } from "@ryadom/shared";
import { getLocale } from "next-intl/server";
import { getSession } from "@/lib/server/session";
import { enterStep } from "../guard";
import { InterestsForm } from "./InterestsForm";

export const dynamic = "force-dynamic";

export default async function InterestsPage() {
  const step = await enterStep("interests");
  const [session, locale] = await Promise.all([getSession(), getLocale()]);
  const [all, mine] = await Promise.all([
    prisma.interest.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    prisma.userInterest.findMany({
      where: { userId: session!.user!.id },
      select: { interestId: true },
    }),
  ]);
  return (
    <InterestsForm
      step={step}
      max={RULES.maxInterestsPerUser}
      interests={all.map((i) => ({ id: i.id, name: locale === "kk" ? i.nameKk : i.nameRu }))}
      initial={mine.map((m) => m.interestId)}
      edit={!!session!.user!.verifiedAt}
    />
  );
}
