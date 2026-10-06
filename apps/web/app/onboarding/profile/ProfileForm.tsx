"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { Progress, Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";
import { BIRTH_KEY } from "../birth/BirthForm";

export function ProfileForm({ step }: { step: { current: number; total: number } }) {
  const t = useTranslations("onboarding.profile");
  const tc = useTranslations("common");
  const router = useRouter();
  const [name, setName] = useState("");
  const [gender, setGender] = useState<"male" | "female" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionStorage.getItem(BIRTH_KEY)) router.replace("/onboarding/birth");
  }, [router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<{ next: string }>("/api/onboarding/profile", {
      json: { birthDate: sessionStorage.getItem(BIRTH_KEY), gender, displayName: name },
    });
    if (!res.ok) {
      setBusy(false);
      if (res.error === "underage" || res.error === "invalid_birth_date")
        router.replace("/onboarding/birth");
      return setError(res.error);
    }
    sessionStorage.removeItem(BIRTH_KEY);
    router.push(res.data.next);
  };

  return (
    <Screen>
      <Progress {...step} label={tc("step", step)} />
      <form className={ui.body} onSubmit={submit}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint")}</p>
        <label className={ui.field}>
          <span className={ui.label}>{t("nameLabel")}</span>
          <input
            className={ui.input}
            autoComplete="given-name"
            maxLength={40}
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <div className={ui.field} role="group" aria-label={t("genderLabel")}>
          <span className={ui.label}>{t("genderLabel")}</span>
          <div className={ui.segmented}>
            {(["female", "male"] as const).map((g) => (
              <button
                key={g}
                type="button"
                className={ui.choice}
                aria-pressed={gender === g}
                onClick={() => setGender(g)}
              >
                {t(g)}
              </button>
            ))}
          </div>
        </div>
        <ErrorText code={error} />
        <div style={{ flex: 1 }} />
        <button
          className={`${ui.button} ${ui.primary}`}
          disabled={busy || name.trim().length < 2 || !gender}
        >
          {busy ? tc("saving") : tc("next")}
        </button>
      </form>
    </Screen>
  );
}
