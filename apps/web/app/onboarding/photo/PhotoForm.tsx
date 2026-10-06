"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { PhotoPicker } from "@/components/PhotoPicker";
import { Progress, Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

export function PhotoForm({
  step,
  hasPhoto,
}: {
  step: { current: number; total: number };
  hasPhoto: boolean;
}) {
  const t = useTranslations("onboarding.photo");
  const tc = useTranslations("common");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return router.push("/onboarding/interests");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("photo", file);
    const res = await api("/api/me/photo", { method: "PUT", form });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push("/onboarding/interests");
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
          chooseLabel={t("choose")}
          changeLabel={t("change")}
          initialUrl={hasPhoto ? "/api/me/photo" : null}
        />
        <p className={ui.note}>{t("privacy")}</p>
        <ErrorText code={error} />
        <button className={`${ui.button} ${ui.primary}`} disabled={busy || (!file && !hasPhoto)}>
          {busy ? tc("saving") : tc("next")}
        </button>
      </form>
    </Screen>
  );
}
