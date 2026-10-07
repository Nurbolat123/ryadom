"use client";

import { TEXT_LIMITS } from "@ryadom/shared";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import type { Person } from "./HerePanel";
import social from "./social.module.css";
import ui from "./ui.module.css";

/** «Привет / Суперпривет»: готовые варианты или своё сообщение. Отправить можно один раз. */
export function HelloSheet({
  person,
  onClose,
  onSent,
}: {
  person: Person;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTranslations("helloSheet");
  const tChat = useTranslations("chat");
  const tPlus = useTranslations("plus");
  const [isSuper, setIsSuper] = useState(false);
  const [message, setMessage] = useState("");
  const [superLeft, setSuperLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const presets = t.raw("presets") as string[];
  const max = isSuper ? TEXT_LIMITS.superHello : TEXT_LIMITS.hello;

  useEffect(() => {
    void api<{ superHellos: number }>("/api/inbox").then(
      (r) => r.ok && setSuperLeft(r.data.superHellos),
    );
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    const res = await api(`/api/people/${person.id}/hello`, {
      json: { isSuper, message: message.trim() },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    onSent();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hello-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="hello-title" className={styles.cardName}>
          {t("title", { name: person.name })}
        </h2>
        <div className={ui.segmented}>
          <button
            type="button"
            className={ui.choice}
            aria-pressed={!isSuper}
            onClick={() => setIsSuper(false)}
          >
            {t("plain")}
          </button>
          <button
            type="button"
            className={ui.choice}
            aria-pressed={isSuper}
            onClick={() => setIsSuper(true)}
            disabled={superLeft === 0}
          >
            {t("super")}
          </button>
        </div>
        {superLeft !== null ? (
          <p className={ui.note}>{t("superLeft", { count: superLeft })}</p>
        ) : null}
        {isSuper ? <p className={ui.note}>{t("superHint")}</p> : null}
        <div className={social.presets}>
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              className={social.preset}
              aria-pressed={message === p}
              onClick={() => setMessage(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <label className={ui.field}>
          <span className={ui.label}>{t("own")}</span>
          <textarea
            className={`${ui.input} ${social.textarea}`}
            value={message}
            maxLength={max}
            rows={3}
            placeholder={t("placeholder")}
            onChange={(e) => setMessage(e.target.value)}
          />
          <span className={social.counter}>{t("counter", { count: message.length, max })}</span>
        </label>
        <p className={ui.note}>{t("once")}</p>
        <ErrorText code={error} />
        {error === "hello_limit" || error === "no_super_hellos" ? (
          <Link href="/plus" className={ui.link}>
            {tPlus("more")}
          </Link>
        ) : null}
        <button
          className={`${ui.button} ${ui.primary}`}
          onClick={send}
          disabled={busy || !message.trim() || message.length > max}
        >
          {t("send")}
        </button>
        <button className={ui.link} onClick={onClose}>
          {tChat("back")}
        </button>
      </div>
    </div>
  );
}
