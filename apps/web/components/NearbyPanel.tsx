"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import type { HereCheckin } from "./HerePanel";
import { PeopleList } from "./PeopleList";
import social from "./social.module.css";
import ui from "./ui.module.css";

/** «Рядом»: кто в этом заведении открыт к знакомству. Без чек-ина — только подсказка отметиться. */
export function NearbyPanel() {
  const t = useTranslations("nearby");
  const [checkin, setCheckin] = useState<HereCheckin | null | undefined>(undefined);

  const load = useCallback(async () => {
    const res = await api<{ checkin: HereCheckin | null }>("/api/checkin");
    setCheckin(res.ok ? res.data.checkin : null);
  }, []);
  useEffect(() => void load(), [load]);
  const ended = useCallback(() => setCheckin(null), []);

  if (checkin === undefined) return <div className={ui.body} />;

  return (
    <div className={ui.body}>
      {checkin ? (
        <>
          <section className={styles.here}>
            <p className={styles.hereLabel}>{t("title")}</p>
            <h1 className={styles.hereName}>{checkin.venue.name}</h1>
          </section>
          <PeopleList key={checkin.venue.id} canGift={checkin.venue.isPartner} onEnded={ended} />
        </>
      ) : (
        <div className={styles.center}>
          <h1 className={ui.title}>{t("title")}</h1>
          <p className={ui.hint}>{t("notHere")}</p>
          <Link href="/home" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
            {t("checkin")}
          </Link>
        </div>
      )}
    </div>
  );
}
