"use client";

import { useTranslations } from "next-intl";
import styles from "./ui.module.css";

/** Текст ошибки по коду из API; незнакомый код — общий текст. */
export function ErrorText({ code, seconds }: { code: string | null; seconds?: number }) {
  const t = useTranslations("errors");
  if (!code) return null;
  return (
    <p className={styles.error} role="alert">
      {t(t.has(code) ? code : "unknown", { seconds: seconds ?? 60 })}
    </p>
  );
}
