"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  canPromptInstall,
  isIosSafari,
  isStandalone,
  onInstallChange,
  promptInstall,
} from "@/lib/client/pwa";
import styles from "./pwa.module.css";
import ui from "./ui.module.css";

const DISMISS_KEY = "ryadom:installDismissedAt";
const DISMISS_DAYS = 14;

const dismissedRecently = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

/**
 * «Добавить на главный экран». Chrome и Android — системное окно установки;
 * iPhone — короткая инструкция (Safari не умеет предлагать установку сам).
 * «Не сейчас» скрывает подсказку на 2 недели.
 */
export function InstallPrompt() {
  const t = useTranslations("pwa");
  const [mode, setMode] = useState<"none" | "prompt" | "ios">("none");

  useEffect(() => {
    const update = () => {
      if (isStandalone() || dismissedRecently()) return setMode("none");
      if (canPromptInstall()) return setMode("prompt");
      setMode(isIosSafari() ? "ios" : "none");
    };
    update();
    return onInstallChange(update);
  }, []);

  if (mode === "none") return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Без localStorage подсказка просто появится снова.
    }
    setMode("none");
  };

  return (
    <aside className={styles.install} aria-label={t("installTitle")}>
      <img src="/icons/icon-192.png" alt="" width={44} height={44} className={styles.installIcon} />
      <div className={styles.installText}>
        <strong>{t("installTitle")}</strong>
        <span>{mode === "ios" ? t("installIos") : t("installHint")}</span>
      </div>
      <div className={styles.installActions}>
        {mode === "prompt" ? (
          <button
            className={`${ui.button} ${ui.primary} ${styles.small}`}
            onClick={() => void promptInstall().then(() => setMode("none"))}
          >
            {t("install")}
          </button>
        ) : null}
        <button className={ui.link} onClick={dismiss}>
          {mode === "ios" ? t("gotIt") : t("notNow")}
        </button>
      </div>
    </aside>
  );
}
