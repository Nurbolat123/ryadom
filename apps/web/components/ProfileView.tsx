"use client";

import { TEXT_LIMITS } from "@ryadom/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { currentEndpoint } from "@/lib/client/pwa";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { usePaymentsEnabled } from "./Features";
import { LanguageSwitch } from "./LanguageSwitch";
import { PushSettings } from "./PushSettings";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Props = {
  user: { displayName: string; about: string; age: number; adsConsent: boolean; isAdmin: boolean };
  interests: string[];
};

/** Профиль: фото, имя, «о себе», интересы, язык, уведомления, согласия, выход, удаление. */
export function ProfileView({ user, interests }: Props) {
  const t = useTranslations("profile");
  const tc = useTranslations("common");
  const payments = usePaymentsEnabled();
  const router = useRouter();
  const [name, setName] = useState(user.displayName);
  const [about, setAbout] = useState(user.about);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ads, setAds] = useState(user.adsConsent);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const res = await api("/api/me", {
      method: "PATCH",
      json: { displayName: name, about },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    router.refresh();
  };

  const toggleAds = async () => {
    const next = !ads;
    setAds(next);
    const res = await api("/api/me", { method: "PATCH", json: { adsConsent: next } });
    if (!res.ok) {
      setAds(!next);
      setError(res.error);
    }
  };

  const logout = async () => {
    const endpoint = await currentEndpoint().catch(() => null);
    await api("/api/auth/logout", { method: "POST", json: endpoint ? { endpoint } : {} });
    router.replace("/");
  };

  const remove = async () => {
    setBusy(true);
    const endpoint = await currentEndpoint().catch(() => null);
    if (endpoint) await api("/api/push/subscribe", { method: "DELETE", json: { endpoint } });
    const res = await api("/api/me", { method: "DELETE", json: { confirm: true } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.replace("/?deleted=1");
  };

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("title")}</h1>

      <section className={`${ui.card} ${social.profileHead}`}>
        <img className={styles.avatar} src="/api/me/photo" alt="" width={72} height={72} />
        <div className={social.itemText}>
          <span className={social.itemName}>
            {user.displayName}, {user.age}
          </span>
          <span className={ui.note}>{t("verified")}</span>
          <Link href="/onboarding/photo" className={ui.link}>
            {t("changePhoto")}
          </Link>
        </div>
      </section>

      <form className={`${ui.card} ${social.adminForm}`} onSubmit={save}>
        <label className={ui.field}>
          <span className={ui.label}>{t("name")}</span>
          <input
            className={ui.input}
            value={name}
            minLength={2}
            maxLength={40}
            required
            autoComplete="given-name"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t("about")}</span>
          <textarea
            className={`${ui.input} ${social.textarea}`}
            value={about}
            maxLength={TEXT_LIMITS.about}
            rows={3}
            placeholder={t("aboutPlaceholder")}
            onChange={(e) => setAbout(e.target.value)}
          />
          <span className={ui.note}>
            {t("aboutHint", { count: about.length, max: TEXT_LIMITS.about })}
          </span>
        </label>
        <ErrorText code={error} />
        {saved ? (
          <p className={ui.note} role="status">
            {t("saved")}
          </p>
        ) : null}
        <button className={`${ui.button} ${ui.primary}`} disabled={busy}>
          {busy ? tc("saving") : tc("save")}
        </button>
      </form>

      <section className={ui.card}>
        <h2 className={social.sectionTitle}>{t("interests")}</h2>
        <div className={styles.interests}>
          {interests.map((i) => (
            <span key={i} className={styles.interest}>
              {i}
            </span>
          ))}
        </div>
        <Link href="/onboarding/interests" className={ui.link}>
          {t("changeInterests")}
        </Link>
      </section>

      <section className={ui.card}>
        <h2 className={social.sectionTitle}>{t("language")}</h2>
        <LanguageSwitch variant="light" />
      </section>

      <section className={ui.card}>
        <h2 className={social.sectionTitle}>{t("notifications")}</h2>
        <PushSettings placement="settings" />
      </section>

      <button
        type="button"
        role="switch"
        aria-checked={ads}
        className={styles.toggle}
        onClick={() => void toggleAds()}
      >
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>{t("adsConsent")}</span>
          <span className={styles.venueMeta}>{t("adsConsentHint")}</span>
        </span>
        <span className={styles.switch} aria-hidden="true" />
      </button>

      <nav className={social.profileLinks}>
        {payments ? (
          <Link href="/plus" className={ui.link}>
            {t("plus")}
          </Link>
        ) : null}
        {user.isAdmin ? (
          <Link href="/admin" className={ui.link}>
            {t("admin")}
          </Link>
        ) : null}
        <button type="button" className={ui.link} onClick={() => void logout()}>
          {t("logout")}
        </button>
      </nav>

      <section className={`${ui.card} ${social.danger}`}>
        <h2 className={social.sectionTitle}>{t("deleteTitle")}</h2>
        <p className={ui.note}>{t("deleteHint")}</p>
        {confirmDelete ? (
          <>
            <p className={ui.error} role="alert">
              {t("deleteConfirm")}
            </p>
            <div className={social.adminActions}>
              <button
                type="button"
                className={`${ui.button} ${ui.secondary}`}
                onClick={() => setConfirmDelete(false)}
              >
                {t("deleteCancel")}
              </button>
              <button
                type="button"
                className={`${ui.button} ${ui.primary}`}
                disabled={busy}
                onClick={() => void remove()}
              >
                {t("deleteForever")}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className={`${ui.button} ${ui.secondary}`}
            onClick={() => setConfirmDelete(true)}
          >
            {t("delete")}
          </button>
        )}
      </section>
    </div>
  );
}
