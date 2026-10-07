"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type View = {
  id: string;
  status: "pending" | "paid" | "failed" | "refunded";
  kind: "plus" | "super_hellos" | "gift";
};

const POLL_MS = 2000;
const POLL_LIMIT = 30;

/** Итог оплаты. Подтверждение приходит webhook'ом; здесь только ждём и сверяемся. */
export function PayReturn({ purchaseId }: { purchaseId: string }) {
  const t = useTranslations("pay");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let tries = 0;
    const poll = async () => {
      const res = await api<View>(`/api/purchases/${purchaseId}`);
      if (stopped) return;
      if (!res.ok) return setError(res.error);
      setView(res.data);
      if (res.data.status === "pending" && ++tries < POLL_LIMIT) setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      stopped = true;
    };
  }, [purchaseId]);

  const back =
    view?.kind === "gift" ? (
      <Link href="/home" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
        {t("toHere")}
      </Link>
    ) : (
      <Link href="/plus" className={`${ui.button} ${ui.primary} ${social.linkButton}`}>
        {t("toPlus")}
      </Link>
    );

  return (
    <div className={ui.body} aria-live="polite">
      <h1 className={ui.title}>
        {view?.status === "paid"
          ? t(`paid.${view.kind}`)
          : view?.status === "failed"
            ? t("failed")
            : view?.status === "refunded"
              ? t("refunded")
              : t("title")}
      </h1>
      {!view || view.status === "pending" ? <p className={ui.hint}>{t("pending")}</p> : null}
      <ErrorText code={error} />
      <div style={{ flex: 1 }} />
      {view && view.status !== "pending" ? back : null}
    </div>
  );
}
