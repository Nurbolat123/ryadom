import { prisma, type User } from "@ryadom/db";
import type { CurrentSession } from "./session";

export const ONBOARDING_STEPS = ["birth", "profile", "photo", "interests", "selfie"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number] | "done";

/** Какой шаг регистрации следующий. */
export const nextStep = async (user: User | null): Promise<OnboardingStep> => {
  if (!user) return "birth";
  if (!user.photo) return "photo";
  if ((await prisma.userInterest.count({ where: { userId: user.id } })) === 0) return "interests";
  if (!user.verifiedAt) return "selfie";
  return "done";
};

export const pathForStep = (step: OnboardingStep) =>
  step === "done" ? "/home" : `/onboarding/${step}`;

/** Куда вести человека с этой сессией. */
export const nextPath = async (session: CurrentSession | null) =>
  session ? pathForStep(await nextStep(session.user)) : "/login";

/**
 * Охрана страниц регистрации: без сессии — на вход; вперёд через шаги не пускаем;
 * дату рождения и имя после создания профиля заново не спрашиваем.
 */
export const guardStep = async (
  page: (typeof ONBOARDING_STEPS)[number],
  session: CurrentSession | null,
): Promise<string | null> => {
  if (!session) return "/login";
  const current = await nextStep(session.user);
  if (current === "done") return page === "photo" || page === "interests" ? null : "/home";
  const order = (s: string) => ONBOARDING_STEPS.indexOf(s as (typeof ONBOARDING_STEPS)[number]);
  if (session.user && (page === "birth" || page === "profile")) return pathForStep(current);
  if (!session.user && page !== "birth" && page !== "profile") return pathForStep(current);
  if (order(page) > order(current) && !(current === "birth" && page === "profile"))
    return pathForStep(current);
  return null;
};
