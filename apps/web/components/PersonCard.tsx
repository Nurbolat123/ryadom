"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import styles from "./checkin.module.css";
import type { Person } from "./HerePanel";
import ui from "./ui.module.css";

/** Карточка человека: фото, имя, возраст, о себе, интересы (общие выделены). Кнопки — на этапе 6. */
export function PersonCard({ person, onClose }: { person: Person; onClose: () => void }) {
  const t = useTranslations("here");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        <p className={ui.note}>{t("actionsSoon")}</p>
        <button ref={closeRef} className={`${ui.button} ${ui.secondary}`} onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </div>
  );
}
