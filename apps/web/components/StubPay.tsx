"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { useMoney } from "./GiftSheet";
import ui from "./ui.module.css";

/** Тестовая оплата: «Оплатить» или «Отменить», затем — как после возврата из Kaspi. */
export function StubPay({
  paymentId,
  purchaseId,
  amount,
  currency,
}: {
  paymentId: string;
  purchaseId: string;
  amount: number;
  currency: string;
}) {
  const t = useTranslations("pay");
  const money = useMoney();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "pay" | "cancel") => {
    setBusy(true);
    setError(null);
    const res = await api(`/api/payments/stub/${paymentId}`, { json: { action } });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    router.replace(`/pay/return?order=${purchaseId}`);
  };

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("stubTitle")}</h1>
      <p className={ui.hint}>{t("stubHint")}</p>
      <section className={ui.card}>
        <strong>{t("amount", { price: money(amount, currency) })}</strong>
      </section>
      <ErrorText code={error} />
      <div style={{ flex: 1 }} />
      <button className={`${ui.button} ${ui.primary}`} onClick={() => act("pay")} disabled={busy}>
        {t("pay")}
      </button>
      <button
        className={`${ui.button} ${ui.secondary}`}
        onClick={() => act("cancel")}
        disabled={busy}
      >
        {t("cancel")}
      </button>
    </div>
  );
}
