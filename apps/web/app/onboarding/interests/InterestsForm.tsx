"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { Progress, Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

export function InterestsForm({
  step,
  max,
  interests,
  initial,
  edit = false,
}: {
  step: { current: number; total: number };
  /** Правка из профиля (регистрация уже пройдена): без шагов, после сохранения — в профиль. */
  edit?: boolean;
  max: number;
  interests: { id: string; name: string }[];
  initial: string[];
}) {
  const t = useTranslations("onboarding.interests");
  const tc = useTranslations("common");
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : s.length < max ? [...s, id] : s,
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api("/api/me/interests", { method: "PUT", json: { interestIds: selected } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(edit ? "/profile" : "/onboarding/selfie");
  };

  return (
    <Screen>
      {edit ? (
        <Link href="/profile" className={ui.link}>
          ← {tc("back")}
        </Link>
      ) : (
        <Progress {...step} label={tc("step", step)} />
      )}
      <form className={ui.body} onSubmit={submit}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint", { max })}</p>
        <div className={ui.chips}>
          {interests.map((i) => (
            <button
              key={i.id}
              type="button"
              className={ui.chip}
              aria-pressed={selected.includes(i.id)}
              disabled={!selected.includes(i.id) && selected.length >= max}
              onClick={() => toggle(i.id)}
            >
              {i.name}
            </button>
          ))}
        </div>
        <p className={ui.note} aria-live="polite">
          {t("counter", { count: selected.length, max })}
        </p>
        <ErrorText code={error} />
        <div className={ui.stickyBottom}>
          <button className={`${ui.button} ${ui.primary}`} disabled={busy || selected.length === 0}>
            {busy ? tc("saving") : edit ? tc("save") : tc("next")}
          </button>
        </div>
      </form>
    </Screen>
  );
}
