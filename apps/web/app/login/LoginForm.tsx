"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

export function LoginForm() {
  const t = useTranslations("login");
  const tc = useTranslations("common");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ code: string; seconds?: number } | null>(null);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const requestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ phone: string; resendAfterSec: number }>("/api/auth/code", {
      json: { phone },
    });
    setBusy(false);
    if (!res.ok) {
      setError({ code: res.error, seconds: res.retryAfterSec });
      if (res.error === "cooldown" && res.retryAfterSec) setResendIn(res.retryAfterSec);
      return;
    }
    setSentTo(res.data.phone);
    setResendIn(res.data.resendAfterSec);
    setCode("");
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ next: string }>("/api/auth/verify", { json: { phone: sentTo, code } });
    if (!res.ok) {
      setBusy(false);
      setError({ code: res.error });
      return;
    }
    router.replace(res.data.next);
  };

  if (!sentTo) {
    return (
      <Screen>
        <form className={ui.body} onSubmit={requestCode}>
          <h1 className={ui.title}>{t("title")}</h1>
          <p className={ui.hint}>{t("hint")}</p>
          <label className={ui.field}>
            <span className={ui.label}>{t("phoneLabel")}</span>
            <input
              className={ui.input}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t("phonePlaceholder")}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />
          </label>
          <ErrorText code={error?.code ?? null} seconds={error?.seconds} />
          <div style={{ flex: 1 }} />
          <button
            className={`${ui.button} ${ui.primary}`}
            disabled={busy || phone.trim().length < 10}
          >
            {busy ? tc("sending") : t("getCode")}
          </button>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <form className={ui.body} onSubmit={verify}>
        <h1 className={ui.title}>{t("codeTitle")}</h1>
        <p className={ui.hint}>{t("codeSentTo", { phone: sentTo })}</p>
        <label className={ui.field}>
          <span className={ui.visuallyHidden}>{t("codeLabel")}</span>
          <input
            className={`${ui.input} ${ui.code}`}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
            required
          />
        </label>
        <ErrorText code={error?.code ?? null} seconds={error?.seconds} />
        <div className={ui.actions}>
          <button
            type="button"
            className={ui.link}
            disabled={resendIn > 0 || busy}
            onClick={() => requestCode()}
          >
            {resendIn > 0 ? t("resendIn", { seconds: resendIn }) : t("resend")}
          </button>
          <button type="button" className={ui.link} onClick={() => setSentTo(null)}>
            {t("changePhone")}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button className={`${ui.button} ${ui.primary}`} disabled={busy || code.length !== 6}>
          {busy ? tc("sending") : t("confirm")}
        </button>
      </form>
    </Screen>
  );
}
