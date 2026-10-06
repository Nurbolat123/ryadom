"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { getPosition, type GeoError } from "@/lib/client/geo";
import { api } from "./api";
import styles from "./checkin.module.css";
import { DevGeoPanel } from "./DevGeoPanel";
import { ErrorText } from "./ErrorText";
import { HerePanel, type HereCheckin } from "./HerePanel";
import ui from "./ui.module.css";

type Venue = {
  id: string;
  slug: string;
  name: string;
  category: string;
  address: string | null;
  isPartner: boolean;
};
type Checkin = HereCheckin & { venue: Venue };

type State =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "locating" }
  | { kind: "geoError"; error: GeoError }
  | { kind: "lowAccuracy" }
  | { kind: "none" }
  | { kind: "choose"; venues: Venue[] }
  | { kind: "here"; checkin: Checkin };

/**
 * Главный экран «Здесь»: «Я здесь» → определение заведения → подтверждение или выбор из нескольких.
 * expectSlug — пришли по ссылке /v/<slug>: список людей всё равно только после проверки геолокации.
 */
export function CheckinPanel({ expectSlug }: { expectSlug?: string }) {
  const t = useTranslations("checkin");
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rechecked = useRef(false);

  const load = useCallback(async () => {
    const res = await api<{ checkin: Checkin | null }>("/api/checkin");
    setState(
      res.ok && res.data.checkin ? { kind: "here", checkin: res.data.checkin } : { kind: "idle" },
    );
    return res.ok ? res.data.checkin : null;
  }, []);

  // При открытии приложения положение перепроверяется (правило 3).
  useEffect(() => {
    void (async () => {
      const current = await load();
      if (!current || rechecked.current) return;
      rechecked.current = true;
      try {
        const pos = await getPosition();
        const res = await api<{ status: string }>("/api/checkin/recheck", { json: pos });
        if (res.ok && res.data.status === "left") await load();
      } catch {
        // без геолокации перепроверить нельзя — присутствие истечёт по TTL
      }
    })();
  }, [load]);

  const imHere = async () => {
    setError(null);
    setState({ kind: "locating" });
    let pos;
    try {
      pos = await getPosition();
    } catch (e) {
      return setState({ kind: "geoError", error: e as GeoError });
    }
    const res = await api<{ venues: Venue[] }>("/api/checkin/locate", { json: pos });
    if (!res.ok) {
      if (res.error === "low_accuracy") return setState({ kind: "lowAccuracy" });
      setError(res.error);
      return setState({ kind: "idle" });
    }
    const venues = expectSlug
      ? [...res.data.venues].sort(
          (a, b) => Number(b.slug === expectSlug) - Number(a.slug === expectSlug),
        )
      : res.data.venues;
    setState(venues.length ? { kind: "choose", venues } : { kind: "none" });
  };

  const confirm = async (venueId: string) => {
    setBusy(true);
    setError(null);
    const res = await api<{ checkin: Checkin }>("/api/checkin", { json: { venueId } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return setState({ kind: "idle" });
    }
    setState({ kind: "here", checkin: res.data.checkin });
  };

  const leave = async () => {
    await api("/api/checkin", { method: "DELETE" });
    setState({ kind: "idle" });
  };

  // Отметка закончилась сама (2 часа или вышли за геозону) — возвращаемся к «Я здесь».
  const ended = useCallback(() => setState({ kind: "idle" }), []);

  const category = (c: string) => t(`category.${c}` as "category.cafe");

  return (
    <div className={ui.body}>
      {state.kind === "here" ? (
        <HerePanel
          key={state.checkin.venue.id}
          checkin={state.checkin}
          onLeave={leave}
          onEnded={ended}
          onRefresh={load}
        />
      ) : state.kind === "choose" ? (
        <>
          <h1 className={ui.title}>
            {state.venues.length === 1
              ? t("confirmOne", { name: state.venues[0]!.name })
              : t("chooseTitle")}
          </h1>
          <ul className={styles.venueList}>
            {state.venues.map((v) => (
              <li key={v.id}>
                <button className={styles.venueItem} onClick={() => confirm(v.id)} disabled={busy}>
                  <span className={styles.venueName}>
                    {v.name}
                    {v.isPartner ? <span className={styles.badge}>{t("partner")}</span> : null}
                  </span>
                  <span className={styles.venueMeta}>
                    {category(v.category)}
                    {v.address ? ` · ${v.address}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {expectSlug && !state.venues.some((v) => v.slug === expectSlug) ? (
            <p className={ui.note}>{t("linkNotHere")}</p>
          ) : null}
          <button className={ui.link} onClick={() => setState({ kind: "idle" })}>
            {t("notThese")}
          </button>
          <Link href="/venues/suggest" className={ui.link}>
            {t("noMyVenue")}
          </Link>
        </>
      ) : (
        <>
          <div className={styles.center}>
            <h1 className={ui.title}>{t("title")}</h1>
            <p className={ui.hint}>{t("hint")}</p>
            <button
              className={styles.hereButton}
              onClick={imHere}
              disabled={state.kind === "locating" || state.kind === "loading"}
            >
              {state.kind === "locating" ? t("locating") : t("imHere")}
            </button>
          </div>
          <ErrorText code={error} />
          {state.kind === "lowAccuracy" ? <p className={ui.error}>{t("lowAccuracy")}</p> : null}
          {state.kind === "none" ? (
            <>
              <p className={ui.hint}>{t("noVenue")}</p>
              <Link href="/venues/suggest" className={ui.link}>
                {t("noMyVenue")}
              </Link>
            </>
          ) : null}
          {state.kind === "geoError" && state.error !== "denied" ? (
            <p className={ui.error}>{t("geoUnavailable")}</p>
          ) : null}
          {state.kind === "geoError" && state.error === "denied" ? (
            <section className={styles.help}>
              <h2>{t("deniedTitle")}</h2>
              <p className={ui.note}>{t("deniedHint")}</p>
              <h2>iPhone</h2>
              <ol>
                <li>{t("ios1")}</li>
                <li>{t("ios2")}</li>
                <li>{t("ios3")}</li>
              </ol>
              <h2>Android</h2>
              <ol>
                <li>{t("android1")}</li>
                <li>{t("android2")}</li>
                <li>{t("android3")}</li>
              </ol>
            </section>
          ) : null}
        </>
      )}
      <DevGeoPanel />
    </div>
  );
}
