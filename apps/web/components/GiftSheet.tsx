"use client";

import { TEXT_LIMITS } from "@ryadom/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { api } from "./api";
import styles from "./checkin.module.css";
import { ErrorText } from "./ErrorText";
import type { Person } from "./HerePanel";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Menu = {
  venueName: string;
  items: { id: string; name: string; price: number; currency: string }[];
};

/** Сумма в тиынах → «1 200 ₸». */
export const useMoney = () => {
  const format = useFormatter();
  return (amount: number, currency = "KZT") =>
    format.number(amount / 100, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: 0,
    });
};

/** «Угостить»: меню заведения (только giftable, без алкоголя), пара слов и оплата. */
export function GiftSheet({
  person,
  onClose,
  onSent,
}: {
  person: Person;
  onClose: () => void;
  onSent: () => void;
}) {
  const t = useTranslations("giftSheet");
  const money = useMoney();
  const [menu, setMenu] = useState<Menu | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Menu>("/api/here/menu").then((r) => (r.ok ? setMenu(r.data) : setError(r.error)));
  }, []);

  const item = menu?.items.find((i) => i.id === itemId);

  const pay = async () => {
    if (!item) return;
    setBusy(true);
    setError(null);
    const res = await api(`/api/people/${person.id}/gift`, {
      json: { menuItemId: item.id, note: note.trim() || undefined },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(true);
    onSent();
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gift-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="gift-title" className={styles.cardName}>
          {done ? t("done", { name: person.name }) : t("title", { name: person.name })}
        </h2>
        {done ? (
          <>
            <p className={ui.note}>{t("refundHint")}</p>
            <button className={`${ui.button} ${ui.primary}`} onClick={onClose}>
              {t("close")}
            </button>
          </>
        ) : (
          <>
            {menu ? <p className={ui.note}>{t("hint", { venue: menu.venueName })}</p> : null}
            {menu && menu.items.length === 0 ? <p className={ui.hint}>{t("empty")}</p> : null}
            <div className={social.presets} role="radiogroup">
              {menu?.items.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  role="radio"
                  aria-checked={itemId === i.id}
                  aria-pressed={itemId === i.id}
                  className={`${social.preset} ${social.menuItem}`}
                  onClick={() => setItemId(i.id)}
                >
                  <span>{i.name}</span>
                  <span className={social.price}>{money(i.price, i.currency)}</span>
                </button>
              ))}
            </div>
            <label className={ui.field}>
              <span className={ui.label}>{t("note")}</span>
              <input
                className={ui.input}
                value={note}
                maxLength={TEXT_LIMITS.giftNote}
                placeholder={t("notePlaceholder")}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <p className={social.giftNotice}>{t("noObligation")}</p>
            <p className={ui.note}>{t("refundHint")}</p>
            {process.env.NODE_ENV !== "production" ? (
              <p className={ui.note}>{t("testPay")}</p>
            ) : null}
            <ErrorText code={error} />
            <button className={`${ui.button} ${ui.primary}`} onClick={pay} disabled={busy || !item}>
              {item
                ? t("pay", { price: money(item.price, item.currency) })
                : t("title", { name: person.name })}
            </button>
            <button className={ui.link} onClick={onClose}>
              {t("close")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
