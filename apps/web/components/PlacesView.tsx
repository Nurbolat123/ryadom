"use client";

import { VenueCategory } from "@ryadom/shared";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import styles from "./places.module.css";
import ui from "./ui.module.css";

type City = "almaty" | "astana";
type Sort = "activity" | "near";
type Activity = "3-5" | "5-10" | "10+";
type Item = {
  slug: string;
  name: string;
  category: VenueCategory;
  address: string | null;
  isPartner: boolean;
  activity: Activity | null;
  offer: { title: string; isAd: boolean; byInterests: boolean } | null;
  distanceM?: number;
};
type Offer = {
  id: string;
  venueSlug: string;
  venueName: string;
  title: string;
  description: string | null;
  endsAt: string;
  isAd: boolean;
  byInterests: boolean;
};
type Page = {
  items: Item[];
  promos: Offer[];
  event: Offer | null;
  nextOffset: number | null;
  attribution: { text: string; license: string; url: string };
};

const CITY_KEY = "ryadom:placesCity";
const CATEGORIES = VenueCategory.filter((c) => c !== "other" && c !== "event");

const readCity = (): City => {
  try {
    return localStorage.getItem(CITY_KEY) === "astana" ? "astana" : "almaty";
  } catch {
    return "almaty";
  }
};

/** Точка нужна только для сортировки «Рядом»: отправляется в теле запроса и не сохраняется. */
const locate = () =>
  new Promise<{ lat: number; lng: number }>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      reject,
      { enableHighAccuracy: false, maximumAge: 300_000, timeout: 15_000 },
    ),
  );

export const clickOffer = (id: string) =>
  void fetch(`/api/offers/${id}/click`, { method: "POST", keepalive: true }).catch(() => undefined);

export function ActivityTag({ activity }: { activity: Activity | null }) {
  const t = useTranslations("places");
  return activity ? <span className={styles.activity}>{t(`activity.${activity}`)}</span> : null;
}

/** «Где знакомятся сейчас»: список мест с активностью диапазонами, фильтры, реклама по контексту. */
export function PlacesView() {
  const t = useTranslations("places");
  const tc = useTranslations("checkin.category");
  const ts = useTranslations("suggest.cities");
  const [city, setCity] = useState<City | null>(null);
  const [category, setCategory] = useState<VenueCategory | null>(null);
  const [sort, setSort] = useState<Sort>("activity");
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearDenied, setNearDenied] = useState(false);

  useEffect(() => setCity(readCity()), []);

  const load = useCallback(
    async (offset: number) => {
      if (!city) return;
      setBusy(true);
      setError(null);
      const res = await api<Page>("/api/places", {
        json: {
          city,
          category: category ?? undefined,
          sort: sort === "near" && near ? "near" : "activity",
          near: sort === "near" && near ? near : undefined,
          offset,
        },
      });
      setBusy(false);
      if (!res.ok) return setError(res.error);
      setPage((prev) =>
        offset && prev ? { ...res.data, items: [...prev.items, ...res.data.items] } : res.data,
      );
    },
    [city, category, sort, near],
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const chooseCity = (c: City) => {
    setCity(c);
    try {
      localStorage.setItem(CITY_KEY, c);
    } catch {
      // Город просто не запомнится.
    }
  };

  const chooseSort = async (s: Sort) => {
    setNearDenied(false);
    if (s === "near" && !near) {
      try {
        setNear(await locate());
      } catch {
        setNearDenied(true);
        return;
      }
    }
    setSort(s);
  };

  const distance = (m: number) =>
    m >= 1000
      ? t("distance", { km: (m / 1000).toFixed(1).replace(".", ",") })
      : t("distanceM", { m });

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("title")}</h1>
      <p className={ui.hint}>{t("subtitle")}</p>

      <div className={styles.controls}>
        <div className={ui.segmented} role="group" aria-label={t("city")}>
          {(["almaty", "astana"] as const).map((c) => (
            <button
              key={c}
              className={ui.choice}
              aria-pressed={city === c}
              onClick={() => chooseCity(c)}
            >
              {ts(c)}
            </button>
          ))}
        </div>
        <div className={styles.scrollChips} role="group">
          <button
            className={ui.chip}
            aria-pressed={category === null}
            onClick={() => setCategory(null)}
          >
            {t("all")}
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={ui.chip}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
            >
              {tc(c)}
            </button>
          ))}
        </div>
        <div className={styles.scrollChips} role="group">
          <button
            className={ui.chip}
            aria-pressed={sort === "activity"}
            onClick={() => void chooseSort("activity")}
          >
            {t("sortActivity")}
          </button>
          <button
            className={ui.chip}
            aria-pressed={sort === "near"}
            onClick={() => void chooseSort("near")}
          >
            {t("sortNear")}
          </button>
        </div>
        {nearDenied ? <p className={ui.note}>{t("nearDenied")}</p> : null}
      </div>

      <Link
        href={`/places/top?city=${city ?? "almaty"}`}
        className={`${ui.link} ${styles.topLink}`}
      >
        {t("top")} →
      </Link>

      {page?.event ? (
        <Link
          href={`/places/${page.event.venueSlug}`}
          className={styles.promo}
          onClick={() => clickOffer(page.event!.id)}
        >
          <span className={styles.meta}>
            {t("eventOfDay")} · {page.event.venueName}
          </span>
          <span className={styles.promoTitle}>{page.event.title}</span>
          {page.event.description ? (
            <span className={styles.meta}>{page.event.description}</span>
          ) : null}
          {page.event.isAd ? <span className={styles.adTag}>{t("ad")}</span> : null}
          {page.event.byInterests ? <span className={styles.meta}>{t("byInterests")}</span> : null}
        </Link>
      ) : null}
      {page?.promos.map((o) => (
        <Link
          key={o.id}
          href={`/places/${o.venueSlug}`}
          className={styles.promo}
          onClick={() => clickOffer(o.id)}
        >
          <span className={styles.meta}>{o.venueName}</span>
          <span className={styles.promoTitle}>{o.title}</span>
          {o.description ? <span className={styles.meta}>{o.description}</span> : null}
          {o.isAd ? <span className={styles.adTag}>{t("ad")}</span> : null}
          {o.byInterests ? <span className={styles.meta}>{t("byInterests")}</span> : null}
        </Link>
      ))}

      <ErrorText code={error} />
      {page && page.items.length === 0 ? <p className={ui.hint}>{t("empty")}</p> : null}
      <ul className={styles.list}>
        {page?.items.map((v) => (
          <li key={v.slug}>
            <Link href={`/places/${v.slug}`} className={styles.place}>
              <span className={styles.placeHead}>
                <span className={styles.placeName}>{v.name}</span>
                {v.distanceM !== undefined ? (
                  <span className={styles.meta}>{distance(v.distanceM)}</span>
                ) : null}
              </span>
              <span className={styles.meta}>
                {tc(v.category)}
                {v.address ? ` · ${v.address}` : ""}
              </span>
              <span className={styles.tags}>
                <ActivityTag activity={v.activity} />
                {v.isPartner ? <span className={styles.tag}>{t("partner")}</span> : null}
                {v.offer ? <span className={styles.offerTag}>{v.offer.title}</span> : null}
                {v.offer?.isAd ? <span className={styles.adTag}>{t("ad")}</span> : null}
                {v.offer?.byInterests ? (
                  <span className={styles.meta}>{t("byInterests")}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {page?.nextOffset ? (
        <button
          className={`${ui.button} ${ui.secondary}`}
          onClick={() => void load(page.nextOffset!)}
          disabled={busy}
        >
          {t("more")}
        </button>
      ) : null}
      {page ? (
        <p className={styles.attribution}>
          <a href={page.attribution.url} target="_blank" rel="noreferrer">
            {t("source", { source: `${page.attribution.text} (${page.attribution.license})` })}
          </a>
        </p>
      ) : null}
    </div>
  );
}
