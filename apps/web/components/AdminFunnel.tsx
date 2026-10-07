"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Data = {
  days: number;
  steps: string[];
  rows: { day: string; venueName: string | null; counts: Record<string, number> }[];
};

/** Воронка по заведению и дню: только счётчики событий, без людей. */
export function AdminFunnel() {
  const t = useTranslations("admin");
  const format = useFormatter();
  const [days, setDays] = useState(14);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Data>(`/api/admin/funnel?days=${days}`).then((r) =>
      r.ok ? setData(r.data) : setError(r.error),
    );
  }, [days]);

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("funnelTitle")}</h1>
      <AdminNav />
      <div className={ui.segmented}>
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            type="button"
            className={ui.choice}
            aria-pressed={days === d}
            onClick={() => setDays(d)}
          >
            {t("funnelDays", { days: d })}
          </button>
        ))}
      </div>
      <p className={ui.note}>{t("funnelHint")}</p>
      <ErrorText code={error} />
      {data?.rows.length === 0 ? <p className={ui.hint}>{t("funnelEmpty")}</p> : null}
      <div className={social.tableWrap}>
        <table className={social.table}>
          <thead>
            <tr>
              <th scope="col">{t("col.day")}</th>
              <th scope="col">{t("col.venue")}</th>
              {data?.steps.map((s) => (
                <th key={s} scope="col">
                  {t(`step.${s}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={`${r.day}|${r.venueName ?? ""}`}>
                <th scope="row">
                  {format.dateTime(new Date(`${r.day}T12:00:00Z`), { dateStyle: "short" })}
                </th>
                <td>{r.venueName ?? t("noVenue")}</td>
                {data.steps.map((s) => (
                  <td key={s}>{r.counts[s] ?? 0}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
