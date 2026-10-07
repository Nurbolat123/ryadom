"use client";

import type { VenueCategory } from "@ryadom/shared";
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { ActivityTag } from "./PlacesView";
import styles from "./places.module.css";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Offer = {
  id: string;
  type: "discount" | "event" | "promo";
  title: string;
  description: string | null;
  endsAt: string;
  isAd: boolean;
  byInterests: boolean;
};
export type Place = {
  slug: string;
  name: string;
  category: VenueCategory;
  address: string | null;
  isPartner: boolean;
  activity: "3-5" | "5-10" | "10+" | null;
  popularHours: number[][];
  today: number;
  offers: Offer[];
};

/** Часы на графике: с 8 утра до 2 ночи. */
const HOURS = [...Array.from({ length: 16 }, (_, i) => i + 8), 0, 1];

/** Страница места: активность, популярные часы по дням недели, предложения и код скидки. */
export function PlaceView({ place, signedIn }: { place: Place; signedIn: boolean }) {
  const t = useTranslations("places");
  const tc = useTranslations("checkin.category");
  const format = useFormatter();
  const [day, setDay] = useState(place.today);
  const [codes, setCodes] = useState<Record<string, { code: string; expiresAt: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const weekdays = t.raw("weekdays") as string[];
  const levels = t.raw("levels") as string[];
  const hasHours = place.popularHours.some((d) => d.some((l) => l > 0));
  // Заканчивается в ближайшие сутки — время («до 23:00»), иначе дата («до 21 октября»).
  const date = (iso: string) => {
    const d = new Date(iso);
    return d.getTime() - Date.now() < 86_400_000
      ? format.dateTime(d, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" })
      : format.dateTime(d, { day: "numeric", month: "long", timeZone: "Asia/Almaty" });
  };

  const getCode = async (id: string) => {
    setError(null);
    const res = await api<{ code: string; expiresAt: string }>(`/api/offers/${id}/code`, {
      method: "POST",
    });
    if (!res.ok) return setError(res.error);
    setCodes((c) => ({ ...c, [id]: res.data }));
  };

  return (
    <div className={ui.body}>
      <Link href="/places" className={`${ui.link} ${styles.topLink}`}>
        ← {t("back")}
      </Link>
      <h1 className={ui.title}>{place.name}</h1>
      <p className={styles.meta}>
        {tc(place.category)}
        {place.address ? ` · ${place.address}` : ""}
      </p>
      <div className={styles.tags}>
        <ActivityTag activity={place.activity} />
        {!place.activity ? <span className={styles.tag}>{t("quiet")}</span> : null}
        {place.isPartner ? <span className={styles.tag}>{t("partner")}</span> : null}
      </div>

      {place.offers.length ? <h2 className={social.sectionTitle}>{t("offers")}</h2> : null}
      {place.offers.map((o) => (
        <section key={o.id} className={ui.card}>
          <strong>{o.title}</strong>
          {o.description ? <p className={ui.note}>{o.description}</p> : null}
          <p className={styles.meta}>
            {t("until", { date: date(o.endsAt) })}
            {o.isAd ? ` · ${t("ad")}` : ""}
            {o.byInterests ? ` · ${t("byInterests")}` : ""}
          </p>
          {o.type === "discount" ? (
            codes[o.id] ? (
              <>
                <p className={styles.code}>{codes[o.id]!.code}</p>
                <p className={ui.note}>{t("codeHint", { date: date(codes[o.id]!.expiresAt) })}</p>
              </>
            ) : signedIn ? (
              <button className={`${ui.button} ${ui.secondary}`} onClick={() => void getCode(o.id)}>
                {t("getCode")}
              </button>
            ) : (
              <p className={ui.note}>{t("codeLogin")}</p>
            )
          ) : null}
        </section>
      ))}
      <ErrorText code={error} />

      <h2 className={social.sectionTitle}>{t("popular")}</h2>
      {hasHours ? (
        <section className={ui.card}>
          <p className={ui.note}>{t("popularHint")}</p>
          <div className={styles.scrollChips} role="group">
            {weekdays.map((w, i) => (
              <button
                key={w}
                className={ui.chip}
                aria-pressed={day === i}
                onClick={() => setDay(i)}
              >
                {w}
              </button>
            ))}
          </div>
          <div className={styles.hours} role="img" aria-label={t("popular")}>
            {HOURS.map((h) => {
              const level = place.popularHours[day]?.[h] ?? 0;
              return (
                <span
                  key={h}
                  className={styles.bar}
                  data-level={level}
                  title={`${h}:00 — ${levels[level]}`}
                />
              );
            })}
          </div>
          <div className={styles.hourLabels} aria-hidden>
            {HOURS.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
        </section>
      ) : (
        <p className={ui.note}>{t("popularEmpty")}</p>
      )}

      <div style={{ flex: 1 }} />
      <Link href={`/v/${place.slug}`} className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
        {t("imHere")}
      </Link>
    </div>
  );
}
