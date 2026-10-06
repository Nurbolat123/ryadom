import { redirect } from "next/navigation";
import { guardStep, ONBOARDING_STEPS } from "@/lib/server/onboarding";
import { getSession } from "@/lib/server/session";

/** Вызывается в начале каждой страницы регистрации. Возвращает номер шага для прогресса. */
export const enterStep = async (page: (typeof ONBOARDING_STEPS)[number]) => {
  const to = await guardStep(page, await getSession());
  if (to) redirect(to);
  return { current: ONBOARDING_STEPS.indexOf(page) + 1, total: ONBOARDING_STEPS.length };
};
