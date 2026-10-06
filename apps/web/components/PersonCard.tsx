"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { GiftSheet } from "./GiftSheet";
import { HelloSheet } from "./HelloSheet";
import { SafetySheet } from "./SafetySheet";
import type { Person } from "./HerePanel";
import social from "./social.module.css";
import ui from "./ui.module.css";

/**
 * Карточка человека: фото, имя, возраст, о себе, интересы (общие выделены);
 * «Симпатия» (сердечко), «Привет» и «Угостить» (только в заведениях-партнёрах).
 */
export function PersonCard({
  person,
  canGift,
  onClose,
  onChanged,
  onMatch,
  onBlocked,
}: {
  person: Person;
  /** Заведение — партнёр с меню. */
  canGift: boolean;
  onClose: () => void;
  onChanged: () => void;
  onMatch: (chatId: string) => void;
  /** Человек заблокирован: карточку закрыть, список обновить. */
  onBlocked: () => void;
}) {
  const t = useTranslations("here");
  const tc = useTranslations("card");
  const tSafety = useTranslations("safety");
  const closeRef = useRef<HTMLButtonElement>(null);
  const [liked, setLiked] = useState(person.liked);
  const [helloOpen, setHelloOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setLiked(person.liked), [person.liked]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && !helloOpen && !safetyOpen && !giftOpen && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, helloOpen, safetyOpen, giftOpen]);

  const toggleLike = async () => {
    setBusy(true);
    setError(null);
    const res = liked
      ? await api(`/api/people/${person.id}/sympathy`, { method: "DELETE" })
      : await api<{ status: "sent" | "match"; chatId?: string }>(
          `/api/people/${person.id}/sympathy`,
          {
            method: "POST",
          },
        );
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const data = res.data as { status?: string; chatId?: string };
    if (data.status === "match" && data.chatId) return onMatch(data.chatId);
    setLiked(!liked);
    onChanged();
  };

  if (helloOpen) {
    return (
      <HelloSheet
        person={person}
        onClose={() => setHelloOpen(false)}
        onSent={() => {
          setHelloOpen(false);
          onChanged();
        }}
      />
    );
  }

  if (giftOpen) {
    return <GiftSheet person={person} onClose={() => setGiftOpen(false)} onSent={onChanged} />;
  }

  if (safetyOpen) {
    return (
      <SafetySheet
        target={{ id: person.id, name: person.name }}
        onClose={() => setSafetyOpen(false)}
        onDone={(blocked) => (blocked ? onBlocked() : setSafetyOpen(false))}
      />
    );
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="person-name"
        onClick={(e) => e.stopPropagation()}
      >
        <img className={styles.cardPhoto} src={person.photoUrl} alt="" />
        <h2 id="person-name" className={styles.cardName}>
          {person.name}, {person.age}
        </h2>
        {person.about ? <p className={styles.cardAbout}>{person.about}</p> : null}
        {person.common.length ? (
          <p className={styles.common}>{t("commonTopic", { list: person.common.join(", ") })}</p>
        ) : null}
        <ul className={styles.interests} aria-label={t("interests")}>
          {person.interests.map((i) => (
            <li key={i.id} className={i.common ? styles.interestCommon : styles.interest}>
              {i.name}
            </li>
          ))}
        </ul>

        {person.chatId ? (
          <Link
            href={`/chats/${person.chatId}`}
            className={`${ui.button} ${ui.primary} ${social.linkButton}`}
          >
            {tc("openChat")}
          </Link>
        ) : (
          <div className={social.actions}>
            <button
              type="button"
              className={social.heart}
              aria-pressed={liked}
              onClick={toggleLike}
              disabled={busy}
            >
              <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.9 0 6 3.9 4.5 7.3C19.5 16.4 12 21 12 21z" />
              </svg>
              {liked ? tc("liked") : tc("like")}
            </button>
            <button
              type="button"
              className={`${ui.button} ${ui.primary}`}
              onClick={() => setHelloOpen(true)}
              disabled={person.helloSent}
            >
              {person.helloSent ? tc("helloSent") : tc("hello")}
            </button>
          </div>
        )}
        {canGift ? (
          <button
            type="button"
            className={`${ui.button} ${ui.secondary}`}
            onClick={() => setGiftOpen(true)}
            disabled={person.giftSent}
          >
            {person.giftSent ? tc("giftSent") : tc("gift")}
          </button>
        ) : null}
        {liked && !person.chatId ? <p className={ui.note}>{tc("likedHint")}</p> : null}
        <ErrorText code={error} />
        <button ref={closeRef} className={`${ui.button} ${ui.secondary}`} onClick={onClose}>
          {t("close")}
        </button>
        <button type="button" className={social.safetyLink} onClick={() => setSafetyOpen(true)}>
          {tSafety("open")}
        </button>
      </div>
    </div>
  );
}
