"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/lib/client/realtime";
import { api } from "./api";
import styles from "./checkin.module.css";
import { announceMatch } from "./MatchOverlay";
import { PersonCard } from "./PersonCard";
import social from "./social.module.css";
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

/**
 * Живой список людей в текущем заведении («Рядом»). Сервер отдаёт его только тем,
 * кто отмечен здесь и сам открыт к знакомству; обновляется по сигналу из realtime.
 */
export function PeopleList({ canGift, onEnded }: { canGift: boolean; onEnded: () => void }) {
  const t = useTranslations("here");
  const [open, setOpen] = useState<boolean | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [selected, setSelected] = useState<Person | null>(null);
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

  useRealtime({ onPeopleChanged: () => void loadPeople(), onEnded });

  if (open === false)
    return (
      <>
        <p className={ui.hint}>{t("turnOnToSee")}</p>
        <Link href="/home" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
          {t("goTurnOn")}
        </Link>
      </>
    );
  if (people === null) return null;

  return (
    <>
      {people.length === 0 ? (
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

      {selected ? (
        <PersonCard
          person={selected}
          canGift={canGift}
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
