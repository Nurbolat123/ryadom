"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { api } from "./api";
import styles from "./welcome.module.css";

export function LanguageSwitch() {
  const locale = useLocale();
  const t = useTranslations("language");
  const router = useRouter();
  const set = async (l: "ru" | "kk") => {
    if (l === locale) return;
    await api("/api/locale", { json: { locale: l } });
    router.refresh();
  };
  return (
    <div className={styles.lang} role="group" aria-label={t("label")}>
      {(["ru", "kk"] as const).map((l) => (
        <button key={l} type="button" aria-pressed={l === locale} onClick={() => set(l)} lang={l}>
          {t(l)}
        </button>
      ))}
    </div>
  );
}
