import { cookies, headers } from "next/headers";

export const LOCALES = ["ru", "kk"] as const;
export type AppLocale = (typeof LOCALES)[number];

/**
 * Язык интерфейса: выбранный человеком (cookie «locale»), иначе — первый из ru/kk
 * в настройках браузера (Accept-Language), иначе русский.
 */
export const detectLocale = (cookie: string | undefined, acceptLanguage: string | null) => {
  if (cookie === "kk" || cookie === "ru") return cookie;
  const ranked = (acceptLanguage ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((l): l is { lang: AppLocale; q: number; i: number } =>
      (LOCALES as readonly string[]).includes(l.lang ?? ""),
    )
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked[0]?.lang ?? "ru";
};

export const requestLocale = async (): Promise<AppLocale> =>
  detectLocale((await cookies()).get("locale")?.value, (await headers()).get("accept-language"));
