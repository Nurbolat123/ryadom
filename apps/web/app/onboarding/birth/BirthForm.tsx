"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { Progress, Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

export const BIRTH_KEY = "ryadom:signup:birthDate";

const isoDaysAgoYears = (years: number) => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
};

export function BirthForm({ step }: { step: { current: number; total: number } }) {
  const t = useTranslations("onboarding.birth");
  const tc = useTranslations("common");
  const router = useRouter();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api("/api/onboarding/age", { json: { birthDate: date } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    sessionStorage.setItem(BIRTH_KEY, date);
    router.push("/onboarding/profile");
  };

  return (
    <Screen>
      <Progress {...step} label={tc("step", step)} />
      <form className={ui.body} onSubmit={submit}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint")}</p>
        <label className={ui.field}>
          <span className={ui.label}>{t("label")}</span>
          <input
            className={ui.input}
            type="date"
            min={isoDaysAgoYears(100)}
            max={isoDaysAgoYears(0)}
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <ErrorText code={error} />
        <div style={{ flex: 1 }} />
        <button
          className={`${ui.button} ${ui.primary}`}
          disabled={busy || !date || error === "underage"}
        >
          {busy ? tc("sending") : tc("next")}
        </button>
      </form>
    </Screen>
  );
}
