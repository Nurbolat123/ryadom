"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import ui from "./ui.module.css";

const LINKS = [
  ["/admin", "reportsLink"],
  ["/admin/venues", "venuesLink"],
  ["/admin/suggestions", "suggestionsLink"],
  ["/admin/gifts", "giftsLink"],
  ["/admin/offers", "offersLink"],
  ["/admin/partners", "partnersLink"],
  ["/admin/funnel", "funnelLink"],
] as const;

/** Разделы админки. */
export function AdminNav() {
  const t = useTranslations("admin");
  const path = usePathname();
  return (
    <nav className={ui.chips} aria-label={t("title")}>
      {LINKS.map(([href, key]) => (
        <Link
          key={href}
          href={href}
          className={ui.chip}
          aria-current={
            path === href || (href !== "/admin" && path.startsWith(`${href}/`)) ? "page" : undefined
          }
        >
          {t(key)}
        </Link>
      ))}
    </nav>
  );
}
