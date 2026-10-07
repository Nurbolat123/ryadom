"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushState, type PushState } from "@/lib/client/pwa";
import styles from "./pwa.module.css";
import ui from "./ui.module.css";

/**
 * Уведомления о приветах, взаимной симпатии и подарках, когда приложение закрыто.
 * Включаются только по нажатию — браузер спрашивает разрешение один раз.
 * placement="card" — предложение вверху «Приветов», "row" — состояние и выключение внизу.
 */
const DISMISS_KEY = "ryadom:pushOfferDismissedAt";
const DISMISS_DAYS = 14;

const offerDismissed = () => {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
};

export function PushSettings({ placement }: { placement: "card" | "row" | "settings" }) {
  const t = useTranslations("push");
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(offerDismissed());
    void getPushState()
      .then(setState)
      .catch(() => setState("unavailable"));
  }, []);

  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    setFailed(false);
    try {
      const next = await fn();
      setState(next);
      setFailed(next === "off");
    } catch {
      // Браузер не смог подписаться (нет связи с push-сервисом, приватный режим).
      setState("off");
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Без localStorage предложение просто появится снова.
    }
    setDismissed(true);
  };

  if (placement === "card") {
    if (dismissed) return null;
    if (state === "off")
      return (
        <section className={styles.pushCard}>
          <strong>{t("offerTitle")}</strong>
          <span className={ui.note}>{t("offerHint")}</span>
          {failed ? <span className={ui.error}>{t("failed")}</span> : null}
          <button
            className={`${ui.button} ${ui.primary}`}
            onClick={() => void run(enablePush)}
            disabled={busy}
          >
            {t("enable")}
          </button>
          <button className={ui.link} onClick={dismiss}>
            {t("notNow")}
          </button>
        </section>
      );
    if (state === "needs-install")
      return (
        <section className={styles.pushCard}>
          <span className={ui.note}>{t("iosInstall")}</span>
          <button className={ui.link} onClick={dismiss}>
            {t("notNow")}
          </button>
        </section>
      );
    return null;
  }

  // Профиль: состояние всегда видно, включить и выключить можно отсюда.
  if (placement === "settings") {
    if (state === null) return null;
    if (state === "off")
      return (
        <div className={styles.pushRow}>
          <span className={ui.note}>{t("offerHint")}</span>
          <button
            className={`${ui.button} ${ui.secondary}`}
            onClick={() => void run(enablePush)}
            disabled={busy}
          >
            {t("enable")}
          </button>
          {failed ? <span className={ui.error}>{t("failed")}</span> : null}
        </div>
      );
    const text = {
      on: "on",
      denied: "denied",
      "needs-install": "iosInstall",
      unavailable: "unavailable",
    } as const;
    return (
      <p className={`${ui.note} ${styles.pushRow}`}>
        {t(text[state])}{" "}
        {state === "on" ? (
          <button className={ui.link} onClick={() => void run(disablePush)} disabled={busy}>
            {t("disable")}
          </button>
        ) : null}
      </p>
    );
  }

  if (state === "on")
    return (
      <p className={`${ui.note} ${styles.pushRow}`}>
        {t("on")}{" "}
        <button className={ui.link} onClick={() => void run(disablePush)} disabled={busy}>
          {t("disable")}
        </button>
      </p>
    );
  // Предложение скрыто на время — включить можно здесь, внизу «Приветов».
  if (state === "off" && dismissed)
    return (
      <div className={styles.pushRow}>
        <button className={ui.link} onClick={() => void run(enablePush)} disabled={busy}>
          {t("enable")}
        </button>
        {failed ? <span className={ui.error}>{t("failed")}</span> : null}
      </div>
    );
  if (state === "denied") return <p className={`${ui.note} ${styles.pushRow}`}>{t("denied")}</p>;
  return null;
}
