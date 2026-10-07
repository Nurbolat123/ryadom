"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Row = {
  venueName: string;
  isPartner: boolean;
  impressions: number;
  clicks: number;
  codesIssued: number;
  redemptions: number;
  checkins: number;
};

const COLS = ["impressions", "clicks", "codesIssued", "redemptions", "checkins"] as const;

/** Отчёт для партнёров: показы, переходы, коды и погашения предложений, чек-ины. */
export function AdminPartners() {
  const t = useTranslations("admin");
  const [data, setData] = useState<{ days: number; venues: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ days: number; venues: Row[] }>("/api/admin/partners").then((r) =>
      r.ok ? setData(r.data) : setError(r.error),
    );
  }, []);

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("partnersTitle")}</h1>
      <AdminNav />
      <ErrorText code={error} />
      {data ? <p className={ui.note}>{t("partnersPeriod", { days: data.days })}</p> : null}
      {data?.venues.length === 0 ? <p className={ui.hint}>{t("partnersEmpty")}</p> : null}
      <div className={social.tableWrap}>
        <table className={social.table}>
          <thead>
            <tr>
              <th scope="col">{t("col.venue")}</th>
              {COLS.map((c) => (
                <th key={c} scope="col">
                  {t(`col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.venues.map((v) => (
              <tr key={v.venueName}>
                <th scope="row">
                  {v.venueName}
                  {v.isPartner ? ` · ${t("partner")}` : ""}
                </th>
                {COLS.map((c) => (
                  <td key={c}>{v[c]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
