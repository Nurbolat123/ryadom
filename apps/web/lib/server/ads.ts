import { prisma } from "@ryadom/db";
import type { OfferAudience } from "@ryadom/places";
import { getSession } from "./session";

/**
 * Интересы человека для подбора предложений заведений (правило 14): только если он сам включил
 * «Предложения заведений по моим интересам» (adsConsent). Иначе — null, и предложения
 * подбираются только по контексту. Поведение в знакомствах сюда не попадает никогда.
 */
export const offerAudience = async (): Promise<OfferAudience> => {
  const userId = (await getSession())?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { adsConsent: true, interests: { select: { interestId: true } } },
  });
  if (!user?.adsConsent) return null;
  return user.interests.map((i) => i.interestId);
};
