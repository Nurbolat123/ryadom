"use client";

import { REPORT_REASONS, TEXT_LIMITS } from "@ryadom/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Reason = (typeof REPORT_REASONS)[number];

/**
 * «Пожаловаться или заблокировать» (правило 9): бесплатно и сразу.
 * Заблокированный ничего не узнаёт — просто перестаёт видеть.
 */
export function SafetySheet({
  target,
  onClose,
  onDone,
}: {
  target: { id: string; name: string };
  onClose: () => void;
  /** Вызывается после блокировки (или жалобы с блокировкой): человек больше не виден. */
  onDone: (blocked: boolean) => void;
}) {
  const t = useTranslations("safety");
  const [mode, setMode] = useState<"menu" | "block" | "report" | "sent">("menu");
  const [reason, setReason] = useState<Reason | null>(null);
  const [comment, setComment] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const block = async () => {
    setBusy(true);
    setError(null);
    const res = await api(`/api/people/${target.id}/block`, { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onDone(true);
  };

  const report = async () => {
    if (!reason) return;
    setBusy(true);
    setError(null);
    const res = await api(`/api/people/${target.id}/report`, {
      json: { reason, comment: comment.trim() || undefined, block: alsoBlock },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setMode("sent");
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-title"
        onClick={(e) => e.stopPropagation()}
      >
        {mode === "menu" ? (
          <>
            <h2 id="safety-title" className={styles.cardName}>
              {t("title")}
            </h2>
            <button className={`${ui.button} ${ui.secondary}`} onClick={() => setMode("report")}>
              {t("report")}
            </button>
            <button className={`${ui.button} ${ui.secondary}`} onClick={() => setMode("block")}>
              {t("block")}
            </button>
            <p className={ui.note}>{t("blockHint")}</p>
          </>
        ) : null}

        {mode === "block" ? (
          <>
            <h2 id="safety-title" className={styles.cardName}>
              {t("blockConfirm", { name: target.name })}
            </h2>
            <p className={ui.note}>{t("blockHint")}</p>
            <ErrorText code={error} />
            <button className={`${ui.button} ${ui.primary}`} onClick={block} disabled={busy}>
              {t("block")}
            </button>
          </>
        ) : null}

        {mode === "report" ? (
          <>
            <h2 id="safety-title" className={styles.cardName}>
              {t("reportTitle")}
            </h2>
            <div className={social.presets} role="radiogroup">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  role="radio"
                  aria-checked={reason === r}
                  aria-pressed={reason === r}
                  className={social.preset}
                  onClick={() => setReason(r)}
                >
                  {t(`reasons.${r}`)}
                </button>
              ))}
            </div>
            <label className={ui.field}>
              <span className={ui.label}>{t("comment")}</span>
              <textarea
                className={`${ui.input} ${social.textarea}`}
                value={comment}
                maxLength={TEXT_LIMITS.reportComment}
                rows={3}
                onChange={(e) => setComment(e.target.value)}
              />
            </label>
            <label className={social.check}>
              <input
                type="checkbox"
                checked={alsoBlock}
                onChange={(e) => setAlsoBlock(e.target.checked)}
              />
              {t("alsoBlock")}
            </label>
            <ErrorText code={error} />
            <button
              className={`${ui.button} ${ui.primary}`}
              onClick={report}
              disabled={busy || !reason}
            >
              {t("send")}
            </button>
          </>
        ) : null}

        {mode === "sent" ? (
          <>
            <h2 id="safety-title" className={styles.cardName}>
              {t("done")}
            </h2>
            {alsoBlock ? <p className={ui.note}>{t("blocked")}</p> : null}
            <button className={`${ui.button} ${ui.primary}`} onClick={() => onDone(alsoBlock)}>
              {t("ok")}
            </button>
          </>
        ) : null}

        {mode !== "sent" ? (
          <button className={ui.link} onClick={onClose}>
            {t("cancel")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
