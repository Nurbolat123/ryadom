"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
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
  edit = false,
}: {
  step: { current: number; total: number };
  hasPhoto: boolean;
  /** Смена фото из профиля: после неё нужна новая селфи-проверка. */
  edit?: boolean;
}) {
  const t = useTranslations("onboarding.photo");
  const tc = useTranslations("common");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return router.push(edit ? "/profile" : "/onboarding/interests");
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("photo", file);
    const res = await api("/api/me/photo", { method: "PUT", form });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    router.push(edit ? "/onboarding/selfie" : "/onboarding/interests");
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
        <p className={ui.hint}>{t("hint")}</p>
        <PhotoPicker
          file={file}
          onChange={setFile}
          chooseLabel={t("choose")}
          changeLabel={t("change")}
          initialUrl={hasPhoto ? "/api/me/photo" : null}
        />
        <p className={ui.note}>{t("privacy")}</p>
        {edit ? <p className={ui.note}>{t("reverify")}</p> : null}
        <ErrorText code={error} />
        <button className={`${ui.button} ${ui.primary}`} disabled={busy || (!file && !hasPhoto)}>
          {busy ? tc("saving") : edit ? tc("save") : tc("next")}
        </button>
      </form>
    </Screen>
  );
}
