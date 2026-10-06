"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import social from "./social.module.css";
import ui from "./ui.module.css";

/** «Вы понравились друг другу» + «Подойди и поздоровайся». */
export function MatchOverlay({ chatId, onClose }: { chatId: string; onClose: () => void }) {
  const t = useTranslations("match");
  return (
    <div className={social.match} role="dialog" aria-modal="true" aria-labelledby="match-title">
      <div className={social.matchRings} aria-hidden="true" />
      <img className={social.matchMark} src="/brand/logo-mark-light.svg" alt="" />
      <h2 id="match-title" className={social.matchTitle}>
        {t("title")}
      </h2>
      <p className={social.matchHint}>{t("hint")}</p>
      <div className={social.matchActions}>
        <Link
          href={`/chats/${chatId}`}
          className={`${ui.button} ${ui.primary} ${social.linkButton}`}
          onClick={onClose}
        >
          {t("openChat")}
        </Link>
        <button className={`${ui.button} ${ui.secondary} ${social.matchLater}`} onClick={onClose}>
          {t("later")}
        </button>
      </div>
    </div>
  );
}

/** Показать экран взаимности из любого места (например, после своего же сердечка). */
export const announceMatch = (chatId: string) =>
  window.dispatchEvent(new CustomEvent("ryadom:match", { detail: chatId }));
