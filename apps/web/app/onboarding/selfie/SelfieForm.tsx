"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Progress, Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

export function SelfieForm({ step }: { step: { current: number; total: number } }) {
  const t = useTranslations("onboarding.selfie");
  const tc = useTranslations("common");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("selfie", file);
    const res = await api<{ next: string }>("/api/me/selfie", { form });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.replace(res.data.next);
  };

  return (
    <Screen>
      <Progress {...step} label={tc("step", step)} />
      <form className={ui.body} onSubmit={submit}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint")}</p>
        <PhotoPicker
          file={file}
          onChange={setFile}
          chooseLabel={t("take")}
          changeLabel={t("retake")}
          selfie
        />
        <ErrorText code={error} />
        <div style={{ flex: 1 }} />
        <button className={`${ui.button} ${ui.primary}`} disabled={busy || !file}>
          {busy ? tc("sending") : t("verify")}
        </button>
      </form>
    </Screen>
  );
}
