import type { MetadataRoute } from "next";
import { getLocale, getTranslations } from "next-intl/server";

/** Манифест PWA: установка на главный экран, иконки из brand/app-icon.svg (pnpm --filter @ryadom/web icons). */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("meta");
  return {
    id: "/",
    name: t("title"),
    short_name: t("title"),
    description: t("description"),
    lang: await getLocale(),
    start_url: "/home",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#15171C",
    theme_color: "#15171C",
    categories: ["social", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
