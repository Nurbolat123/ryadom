"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "./api";
import ui from "./ui.module.css";
import styles from "./welcome.module.css";

/** Русский / Қазақша. variant="dark" — на тёмном приветственном экране, "light" — в профиле. */
export function LanguageSwitch({ variant = "dark" }: { variant?: "dark" | "light" }) {
  const locale = useLocale();
  const t = useTranslations("language");
  const router = useRouter();
  const set = async (l: "ru" | "kk") => {
    if (l === locale) return;
    await api("/api/locale", { json: { locale: l } });
    router.refresh();
  };
  return (
    <div
      className={variant === "dark" ? styles.lang : ui.segmented}
      role="group"
      aria-label={t("label")}
    >
      {(["ru", "kk"] as const).map((l) => (
        <button
          key={l}
          type="button"
          className={variant === "dark" ? undefined : ui.choice}
          aria-pressed={l === locale}
          onClick={() => set(l)}
          lang={l}
        >
          {t(l)}
        </button>
      ))}
    </div>
  );
}
