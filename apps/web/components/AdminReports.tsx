"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Report = {
  id: string;
  reason: string;
  comment: string | null;
  action: "dismissed" | "photo_removed" | "banned" | null;
  createdAt: string;
  venueName: string | null;
  reported: {
    id: string;
    name: string;
    about: string | null;
    photoUrl: string | null;
    banned: boolean;
    registeredAt: string;
    reportsTotal: number;
  } | null;
};

/** Жалобы: «Новые» и «Рассмотренные». Кто пожаловался — не показывается. */
export function AdminReports() {
  const t = useTranslations("admin");
  const tReasons = useTranslations("safety.reasons");
  const format = useFormatter();
  const [tab, setTab] = useState<"pending" | "resolved">("pending");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<{ reports: Report[] }>(`/api/admin/reports?status=${tab}`);
    if (res.ok) setReports(res.data.reports);
    else setError(res.error);
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (r: Report, action: NonNullable<Report["action"]>) => {
    if (action === "banned" && !window.confirm(t("banConfirm", { name: r.reported?.name ?? "" })))
      return;
    setError(null);
    const res = await api(`/api/admin/reports/${r.id}`, { json: { action } });
    if (!res.ok) return setError(res.error);
    void load();
  };

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("title")}</h1>
      <AdminNav />
      <div className={ui.segmented}>
        {(["pending", "resolved"] as const).map((k) => (
          <button
            key={k}
            type="button"
            className={ui.choice}
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
          >
            {t(k)}
          </button>
        ))}
      </div>
      <p className={ui.note}>{t("reporterHidden")}</p>
      <ErrorText code={error} />

      {reports?.length === 0 ? <p className={ui.hint}>{t("empty")}</p> : null}
      <ul className={`${styles.people} ${social.section}`}>
        {reports?.map((r) => (
          <li key={r.id} className={social.item}>
            <div className={social.itemHead}>
              {r.reported?.photoUrl ? (
                <img
                  className={styles.avatar}
                  src={r.reported.photoUrl}
                  alt=""
                  width={64}
                  height={64}
                />
              ) : null}
              <span className={social.itemText}>
                <span className={social.itemName}>{r.reported?.name}</span>
                {r.reported ? (
                  <>
                    <span className={ui.note}>
                      {t("registered", { date: date(r.reported.registeredAt) })}
                    </span>
                    <span className={ui.note}>
                      {t("reports", { count: r.reported.reportsTotal })}
                    </span>
                  </>
                ) : null}
              </span>
            </div>
            {r.reported?.about ? <p className={social.message}>{r.reported.about}</p> : null}
            <p className={ui.note}>
              {t("reason")}: <b>{tReasons(r.reason)}</b> · {date(r.createdAt)}
              {r.venueName ? ` · ${t("venue")}: ${r.venueName}` : ""}
            </p>
            {r.comment ? (
              <p className={social.message}>
                {t("comment")}: {r.comment}
              </p>
            ) : null}
            {r.action ? (
              <p className={ui.note}>
                <b>{t(`action.${r.action}`)}</b>
              </p>
            ) : r.reported?.banned ? (
              <p className={ui.note}>
                <b>{t("banned")}</b>
              </p>
            ) : null}
            {tab === "pending" ? (
              <div className={social.adminActions}>
                <button
                  className={`${ui.button} ${ui.secondary}`}
                  onClick={() => act(r, "dismissed")}
                >
                  {t("dismiss")}
                </button>
                <button
                  className={`${ui.button} ${ui.secondary}`}
                  onClick={() => act(r, "photo_removed")}
                  disabled={!r.reported?.photoUrl}
                >
                  {t("removePhoto")}
                </button>
                <button className={`${ui.button} ${ui.primary}`} onClick={() => act(r, "banned")}>
                  {t("ban")}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
