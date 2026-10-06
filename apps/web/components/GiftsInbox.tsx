"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import { useMoney } from "./GiftSheet";
import social from "./social.module.css";
import ui from "./ui.module.css";

export type ReceivedGift = {
  id: string;
  status: "pending" | "accepted" | "redeemed";
  item: string;
  note: string | null;
  venueName: string;
  from: { id: string; name: string; photoUrl: string };
  delivery: "pickup" | "table" | null;
  pickupCode: string | null;
  tableNumber: string | null;
};
export type SentGift = {
  id: string;
  item: string;
  amount: number;
  currency: string;
  toName: string;
  status: "waiting" | "accepted" | "not_received";
  refunded: boolean;
};

/** Полученные подарки (Принять / Не принимать) и отправленные с нейтральным статусом. */
export function GiftsInbox({
  received,
  sent,
  onChanged,
}: {
  received: ReceivedGift[];
  sent: SentGift[];
  onChanged: () => void;
}) {
  const t = useTranslations("gifts");
  const money = useMoney();
  const [accepting, setAccepting] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<"pickup" | "table">("pickup");
  const [table, setTable] = useState("");
  const [error, setError] = useState<string | null>(null);

  const accept = async (id: string) => {
    setError(null);
    const res = await api(`/api/gifts/${id}/accept`, {
      json: delivery === "table" ? { delivery, tableNumber: table.trim() } : { delivery },
    });
    if (!res.ok) return setError(res.error);
    setAccepting(null);
    onChanged();
  };

  const decline = async (id: string) => {
    await api(`/api/gifts/${id}/decline`, { method: "POST" });
    onChanged();
  };

  if (!received.length && !sent.length) return null;

  return (
    <>
      {received.length ? <h2 className={social.sectionTitle}>{t("title")}</h2> : null}
      <ul className={`${styles.people} ${social.section}`}>
        {received.map((g) => (
          <li key={g.id} className={`${social.item} ${social.itemSuper}`}>
            <div className={social.itemHead}>
              <img className={styles.avatar} src={g.from.photoUrl} alt="" width={64} height={64} />
              <span className={social.itemText}>
                <span className={social.itemName}>{t("from", { name: g.from.name })}</span>
                <span className={social.superLabel}>🎁 {g.item}</span>
              </span>
            </div>
            {g.note ? <p className={social.message}>{g.note}</p> : null}

            {g.status === "pending" ? (
              accepting === g.id ? (
                <>
                  <p className={ui.label}>{t("howTitle")}</p>
                  <div className={ui.segmented}>
                    {(["pickup", "table"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={ui.choice}
                        aria-pressed={delivery === d}
                        onClick={() => setDelivery(d)}
                      >
                        {t(d)}
                      </button>
                    ))}
                  </div>
                  {delivery === "table" ? (
                    <label className={ui.field}>
                      <span className={ui.label}>{t("tableNumber")}</span>
                      <input
                        className={ui.input}
                        value={table}
                        maxLength={10}
                        inputMode="numeric"
                        onChange={(e) => setTable(e.target.value)}
                      />
                    </label>
                  ) : null}
                  <ErrorText code={error} />
                  <button
                    className={`${ui.button} ${ui.primary}`}
                    disabled={delivery === "table" && !table.trim()}
                    onClick={() => accept(g.id)}
                  >
                    {t("confirm")}
                  </button>
                </>
              ) : (
                <>
                  <p className={social.giftNotice}>{t("noObligation")}</p>
                  <div className={social.row}>
                    <button
                      className={`${ui.button} ${ui.secondary}`}
                      onClick={() => decline(g.id)}
                    >
                      {t("decline")}
                    </button>
                    <button
                      className={`${ui.button} ${ui.primary}`}
                      onClick={() => {
                        setAccepting(g.id);
                        setDelivery("pickup");
                        setTable("");
                        setError(null);
                      }}
                    >
                      {t("accept")}
                    </button>
                  </div>
                </>
              )
            ) : g.status === "accepted" ? (
              <>
                <p className={social.code}>{g.pickupCode}</p>
                <p className={ui.note}>
                  {g.delivery === "table"
                    ? t("tableHint", { table: g.tableNumber ?? "", code: g.pickupCode ?? "" })
                    : t("pickupHint", { venue: g.venueName })}
                </p>
              </>
            ) : (
              <p className={ui.note}>{t("redeemed")}</p>
            )}
          </li>
        ))}
      </ul>

      {sent.length ? (
        <>
          <h2 className={social.sectionTitle}>{t("sentTitle")}</h2>
          <ul className={`${styles.people} ${social.section}`}>
            {sent.map((g) => (
              <li key={g.id} className={social.item}>
                <span className={social.itemName}>
                  {g.toName} · {g.item} · {money(g.amount, g.currency)}
                </span>
                <span className={ui.note}>
                  {t(`status.${g.status}`)}
                  {g.status === "not_received"
                    ? ` · ${g.refunded ? t("refunded") : t("refundSoon")}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}
