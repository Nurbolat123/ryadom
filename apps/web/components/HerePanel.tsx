"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { usePaymentsEnabled } from "./Features";
import { clickOffer } from "./PlacesView";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Boost = { until: string | null; available: boolean; plus: boolean };

type Venue = { id: string; slug: string; name: string; isPartner: boolean };
export type HereCheckin = {
  venue: Venue;
  openToMeet: boolean;
  expiresAt: string;
  openCount: number | null;
};

/**
 * Экран «Здесь» после чек-ина: заведение, переключатель «Открыт(а) к знакомству», буст,
 * предложения заведения и «Я ушёл(ла)». Сам список людей — на вкладке «Рядом» (PeopleList).
 */
export function HerePanel({
  checkin,
  onLeave,
  onEnded,
  onRefresh,
}: {
  checkin: HereCheckin;
  onLeave: () => Promise<void>;
  onEnded: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const t = useTranslations("here");
  const tc = useTranslations("checkin");
  const tp = useTranslations("plus");
  const payments = usePaymentsEnabled();
  const locale = useLocale();
  const [open, setOpen] = useState(checkin.openToMeet);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boost, setBoost] = useState<Boost | null>(null);
  const [offers, setOffers] = useState<
    { id: string; title: string; isAd: boolean; byInterests: boolean }[]
  >([]);
  const tPlaces = useTranslations("places");

  // Предложения этого заведения — показ по контексту (текущее заведение), без данных о человеке.
  useEffect(() => {
    void api<{ offers: { id: string; title: string; isAd: boolean; byInterests: boolean }[] }>(
      `/api/places/${checkin.venue.slug}`,
    ).then((r) => r.ok && setOffers(r.data.offers));
  }, [checkin.venue.slug]);

  // Список людей живёт на «Рядом»; здесь достаточно знать, включён ли режим.
  const loadOpen = useCallback(async () => {
    const res = await api<{ open: boolean }>("/api/here/people");
    if (res.ok) setOpen(res.data.open);
    else if (res.error === "not_checked_in") onEnded();
  }, [onEnded]);

  const loadBoost = useCallback(async () => {
    const res = await api<{ plus: { active: boolean }; boost: Omit<Boost, "plus"> }>("/api/plus");
    if (res.ok) setBoost({ ...res.data.boost, plus: res.data.plus.active });
  }, []);

  useEffect(() => {
    if (open) void loadBoost();
  }, [open, loadBoost]);

  const startBoost = async () => {
    setBusy(true);
    setError(null);
    const res = await api<{ until: string }>("/api/here/boost", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setBoost((b) => (b ? { ...b, until: res.data.until, available: false } : b));
  };

  useRealtime({
    onPeopleChanged: () => {
      void loadOpen();
      void onRefresh();
    },
    onEnded,
  });

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = await api<{ openToMeet: boolean }>("/api/here/open", { json: { open: !open } });
    setBusy(false);
    if (!res.ok) {
      if (res.error === "not_checked_in") return onEnded();
      return setError(res.error);
    }
    setOpen(res.data.openToMeet);
  };

  const leave = async () => {
    setBusy(true);
    await onLeave();
  };

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "kk" ? "kk-KZ" : "ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const until = time(checkin.expiresAt);

  return (
    <>
      <section className={styles.here}>
        <p className={styles.hereLabel}>{tc("youAreIn")}</p>
        <h1 className={styles.hereName}>{checkin.venue.name}</h1>
        <p className={styles.venueMeta}>{tc("until", { time: until })}</p>
      </section>

      {offers.map((o) => (
        <Link
          key={o.id}
          href={`/places/${checkin.venue.slug}`}
          className={`${ui.card} ${social.hereOffer}`}
          onClick={() => clickOffer(o.id)}
        >
          <strong>{o.title}</strong>
          {o.isAd ? <span className={ui.note}> · {tPlaces("ad")}</span> : null}
          {o.byInterests ? <span className={ui.note}> · {tPlaces("byInterests")}</span> : null}
        </Link>
      ))}

      <button
        type="button"
        role="switch"
        aria-checked={open}
        className={styles.toggle}
        onClick={toggle}
        disabled={busy}
      >
        <span className={styles.toggleText}>
          <span className={styles.toggleTitle}>{t("open")}</span>
          <span className={styles.venueMeta}>{open ? t("openOn") : t("openOff")}</span>
        </span>
        <span className={styles.switch} aria-hidden="true" />
      </button>
      <ErrorText code={error} />

      {checkin.openCount !== null ? (
        <p className={styles.count}>{tc("openCount", { count: checkin.openCount })}</p>
      ) : null}

      {open && boost ? (
        boost.until ? (
          <p className={styles.count}>{tp("boostOn", { time: time(boost.until) })}</p>
        ) : boost.available ? (
          <button className={`${ui.button} ${ui.secondary}`} onClick={startBoost} disabled={busy}>
            {tp("boost")}
            <span className={ui.note}> · {tp("boostHint")}</span>
          </button>
        ) : !boost.plus && payments ? (
          <Link href="/plus" className={`${ui.link} ${social.plusLink}`}>
            {tp("more")}
          </Link>
        ) : null
      ) : null}

      {open ? (
        <Link href="/nearby" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
          {t("seeNearby")}
        </Link>
      ) : (
        <p className={ui.hint}>{t("turnOnToSee")}</p>
      )}

      <div style={{ flex: 1 }} />
      <button className={`${ui.button} ${ui.secondary}`} onClick={leave} disabled={busy}>
        {tc("leave")}
      </button>
    </>
  );
}
