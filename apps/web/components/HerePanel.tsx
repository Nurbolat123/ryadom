"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { announceMatch } from "./MatchOverlay";
import { PersonCard } from "./PersonCard";
import ui from "./ui.module.css";

export type Person = {
  id: string;
  name: string;
  age: number;
  about: string | null;
  photoUrl: string;
  interests: { id: string; name: string; common: boolean }[];
  common: string[];
  liked: boolean;
  helloSent: boolean;
  chatId: string | null;
  giftSent: boolean;
};
type Venue = { id: string; name: string; isPartner: boolean };
export type HereCheckin = {
  venue: Venue;
  openToMeet: boolean;
  expiresAt: string;
  openCount: number | null;
};

/**
 * Экран заведения: переключатель «Открыт(а) к знакомству», живой список людей и «Я ушёл(ла)».
 * Список обновляется по сигналу из realtime-сервиса.
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
  const locale = useLocale();
  const [open, setOpen] = useState(checkin.openToMeet);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [selected, setSelected] = useState<Person | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  // Несколько сигналов подряд схлопываются в один запрос (плюс ещё один, если пришли во время запроса).
  const loadPeople = useCallback(async () => {
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    loading.current = (async () => {
      do {
        again.current = false;
        const res = await api<{ open: boolean; people: Person[] }>("/api/here/people");
        if (!res.ok) {
          if (res.error === "not_checked_in") onEnded();
          break;
        }
        setOpen(res.data.open);
        setPeople(res.data.people);
        setSelected((s) => (s ? (res.data.people.find((p) => p.id === s.id) ?? null) : s));
      } while (again.current);
    })();
    try {
      await loading.current;
    } finally {
      loading.current = null;
    }
  }, [onEnded]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  useRealtime({
    onPeopleChanged: () => {
      void loadPeople();
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
    await loadPeople();
  };

  const leave = async () => {
    setBusy(true);
    await onLeave();
  };

  const until = new Date(checkin.expiresAt).toLocaleTimeString(
    locale === "kk" ? "kk-KZ" : "ru-RU",
    {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    },
  );

  return (
    <>
      <section className={styles.here}>
        <p className={styles.hereLabel}>{tc("youAreIn")}</p>
        <h1 className={styles.hereName}>{checkin.venue.name}</h1>
        <p className={styles.venueMeta}>{tc("until", { time: until })}</p>
      </section>

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

      {!open ? (
        <p className={ui.hint}>{t("turnOnToSee")}</p>
      ) : people === null ? null : people.length === 0 ? (
        <p className={ui.hint}>{t("empty")}</p>
      ) : (
        <ul className={styles.people} aria-label={t("listLabel")} aria-live="polite">
          {people.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.person} onClick={() => setSelected(p)}>
                <img className={styles.avatar} src={p.photoUrl} alt="" width={64} height={64} />
                <span className={styles.personText}>
                  <span className={styles.personName}>
                    {p.name}, {p.age}
                  </span>
                  {p.common.length ? (
                    <span className={styles.common}>
                      {t("common", { list: p.common.join(", ") })}
                    </span>
                  ) : p.about ? (
                    <span className={styles.venueMeta}>{p.about}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div style={{ flex: 1 }} />
      <button className={`${ui.button} ${ui.secondary}`} onClick={leave} disabled={busy}>
        {tc("leave")}
      </button>

      {selected ? (
        <PersonCard
          person={selected}
          canGift={checkin.venue.isPartner}
          onClose={() => setSelected(null)}
          onChanged={() => void loadPeople()}
          onMatch={(chatId) => {
            setSelected(null);
            void loadPeople();
            announceMatch(chatId);
          }}
          onBlocked={() => {
            setSelected(null);
            void loadPeople();
          }}
        />
      ) : null}
    </>
  );
}
