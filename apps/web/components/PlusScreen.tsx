"use client";

import { isPlusProduct, isRenewable, type ProductCode } from "@ryadom/shared";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { useMoney } from "./GiftSheet";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Product = { product: ProductCode; amount: number; currency: string };
type PlusState = {
  plus: {
    active: boolean;
    until: string | null;
    autoRenew: boolean;
    autoRenewProduct: string | null;
  };
  superHellos: { purchased: number; weekly: number; total: number };
  canAutoRenew: boolean;
  products: Product[];
};

/** Экран «Плюс»: что даёт, пропуски, суперприветы. Автопродление — только явной галочкой. */
export function PlusScreen({ testPay }: { testPay: boolean }) {
  const t = useTranslations("plus");
  const format = useFormatter();
  const money = useMoney();
  const [state, setState] = useState<PlusState | null>(null);
  const [selected, setSelected] = useState<ProductCode | null>(null);
  const [autoRenew, setAutoRenew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<PlusState>("/api/plus");
    if (res.ok) setState(res.data);
    else setError(res.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const date = (iso: string) => format.dateTime(new Date(iso), { day: "numeric", month: "long" });

  const buy = async (product: ProductCode) => {
    setBusy(true);
    setError(null);
    const res = await api<{ purchaseId: string; redirectUrl?: string }>("/api/plus/purchase", {
      json: { product, autoRenew: autoRenew && isRenewable(product) && !!state?.canAutoRenew },
    });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    if (res.data.redirectUrl) {
      window.location.href = res.data.redirectUrl;
      return;
    }
    window.location.href = `/pay/return?order=${res.data.purchaseId}`;
  };

  const cancelRenew = async () => {
    setBusy(true);
    const res = await api("/api/plus/auto-renew", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCancelled(true);
    await load();
  };

  const plusProducts = state?.products.filter((p) => isPlusProduct(p.product)) ?? [];
  const superProducts = state?.products.filter((p) => !isPlusProduct(p.product)) ?? [];
  const chosen = state?.products.find((p) => p.product === selected);

  const productButton = (p: Product) => (
    <button
      key={p.product}
      type="button"
      role="radio"
      aria-checked={selected === p.product}
      aria-pressed={selected === p.product}
      className={`${social.preset} ${social.menuItem}`}
      onClick={() => setSelected(p.product)}
    >
      <span>
        {t(`products.${p.product}`)}
        <span className={ui.note}> · {t(`productHint.${p.product}`)}</span>
      </span>
      <span className={social.price}>{money(p.amount, p.currency)}</span>
    </button>
  );

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("title")}</h1>
      <p className={ui.hint}>{t("subtitle")}</p>

      <section className={ui.card}>
        <ul className={social.benefits}>
          {(t.raw("benefits") as string[]).map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <p className={ui.note}>{t("honest")}</p>
      </section>

      {state ? (
        <section className={ui.card} aria-live="polite">
          <strong>
            {state.plus.active && state.plus.until
              ? t("active", { date: date(state.plus.until) })
              : t("inactive")}
          </strong>
          {state.plus.autoRenew && state.plus.until ? (
            <>
              <p className={ui.note}>{t("autoRenewOn", { date: date(state.plus.until) })}</p>
              <button
                className={`${ui.button} ${ui.secondary}`}
                onClick={cancelRenew}
                disabled={busy}
              >
                {t("cancelRenew")}
              </button>
            </>
          ) : null}
          {cancelled ? <p className={ui.note}>{t("renewCancelled")}</p> : null}
        </section>
      ) : null}

      <h2 className={social.sectionTitle}>{t("passes")}</h2>
      <div className={social.presets} role="radiogroup" aria-label={t("passes")}>
        {plusProducts.map(productButton)}
      </div>

      <h2 className={social.sectionTitle}>{t("superTitle")}</h2>
      {state ? (
        <p className={ui.note}>
          {t("superLeft", { count: state.superHellos.total })}
          {state.superHellos.weekly > 0
            ? ` (${t("superWeekly", { count: state.superHellos.weekly })})`
            : ""}
        </p>
      ) : null}
      <div className={social.presets} role="radiogroup" aria-label={t("superTitle")}>
        {superProducts.map(productButton)}
      </div>

      {chosen && !isPlusProduct(chosen.product) ? (
        <p className={ui.note}>{t("superNoRefund")}</p>
      ) : null}
      {chosen && state?.canAutoRenew && isRenewable(chosen.product) ? (
        <label className={social.check}>
          <input
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
          />
          <span>
            {t("autoRenew")}
            <span className={ui.note}> {t("autoRenewHint")}</span>
          </span>
        </label>
      ) : null}
      {testPay ? <p className={ui.note}>{t("testPay")}</p> : null}
      <ErrorText code={error} />

      <div style={{ flex: 1 }} />
      <button
        className={`${ui.button} ${ui.primary}`}
        onClick={() => chosen && void buy(chosen.product)}
        disabled={busy || !chosen}
      >
        {chosen ? t("buy", { price: money(chosen.amount, chosen.currency) }) : t("choose")}
      </button>
    </div>
  );
}
