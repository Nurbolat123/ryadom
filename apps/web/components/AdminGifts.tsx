"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { useMoney } from "./GiftSheet";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Row = {
  venueId: string;
  venueName: string;
  sent: number;
  accepted: number;
  redeemed: number;
  refunded: number;
  revenue: number;
  commission: number;
};

/** Отчёт по подаркам и комиссии по заведениям. */
export function AdminGifts() {
  const t = useTranslations("admin");
  const money = useMoney();
  const [data, setData] = useState<{ days: number; venues: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<{ days: number; venues: Row[] }>("/api/admin/gifts").then((r) =>
      r.ok ? setData(r.data) : setError(r.error),
    );
  }, []);

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("giftsTitle")}</h1>
      <Link href="/admin" className={ui.link}>
        {t("reportsLink")}
      </Link>
      <ErrorText code={error} />
      {data ? <p className={ui.note}>{t("giftsPeriod", { days: data.days })}</p> : null}
      {data?.venues.length === 0 ? <p className={ui.hint}>{t("giftsEmpty")}</p> : null}
      <div className={social.tableWrap}>
        <table className={social.table}>
          <thead>
            <tr>
              {(
                [
                  "venue",
                  "sent",
                  "accepted",
                  "redeemed",
                  "refunded",
                  "revenue",
                  "commission",
                ] as const
              ).map((c) => (
                <th key={c} scope="col">
                  {t(`col.${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.venues.map((v) => (
              <tr key={v.venueId}>
                <th scope="row">{v.venueName}</th>
                <td>{v.sent}</td>
                <td>{v.accepted}</td>
                <td>{v.redeemed}</td>
                <td>{v.refunded}</td>
                <td>{money(v.revenue)}</td>
                <td>{money(v.commission)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
