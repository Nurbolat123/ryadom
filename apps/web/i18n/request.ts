import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

export const LOCALES = ["ru", "kk"] as const;
export type AppLocale = (typeof LOCALES)[number];

/** Язык берётся из cookie «locale» (ставится переключателем и при входе из профиля). */
export default getRequestConfig(async () => {
  const value = (await cookies()).get("locale")?.value;
  const locale: AppLocale = value === "kk" ? "kk" : "ru";
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
