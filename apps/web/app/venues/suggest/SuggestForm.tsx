"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { api } from "@/components/api";
import { ErrorText } from "@/components/ErrorText";
import { Screen } from "@/components/Screen";
import ui from "@/components/ui.module.css";

const CATEGORIES = ["cafe", "coffee", "bar", "restaurant", "coworking", "other"] as const;

/** «Нет моего заведения»: название, город, категория, адрес. Координаты не отправляются (правило 4). */
export function SuggestForm() {
  const t = useTranslations("suggest");
  const tc = useTranslations("checkin");
  const router = useRouter();
  const [name, setName] = useState("");
  const [city, setCity] = useState<"astana" | "almaty">("astana");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("cafe");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api("/api/venues/suggestions", {
      json: { name, city, category, ...(address.trim() ? { address } : {}) },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <div className={ui.body}>
          <h1 className={ui.title}>{t("thanks")}</h1>
          <p className={ui.hint}>{t("thanksHint")}</p>
          <div style={{ flex: 1 }} />
          <button className={`${ui.button} ${ui.primary}`} onClick={() => router.replace("/home")}>
            {t("back")}
          </button>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <form className={ui.body} onSubmit={submit}>
        <h1 className={ui.title}>{t("title")}</h1>
        <p className={ui.hint}>{t("hint")}</p>
        <label className={ui.field}>
          <span className={ui.label}>{t("name")}</span>
          <input
            className={ui.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            required
          />
        </label>
        <div className={ui.field} role="group" aria-label={t("city")}>
          <span className={ui.label}>{t("city")}</span>
          <div className={ui.segmented}>
            {(["astana", "almaty"] as const).map((c) => (
              <button
                key={c}
                type="button"
                className={ui.choice}
                aria-pressed={city === c}
                onClick={() => setCity(c)}
              >
                {t(`cities.${c}`)}
              </button>
            ))}
          </div>
        </div>
        <label className={ui.field}>
          <span className={ui.label}>{t("category")}</span>
          <select
            className={ui.input}
            value={category}
            onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(`category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t("address")}</span>
          <input
            className={ui.input}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={200}
          />
        </label>
        <ErrorText code={error} />
        <button className={`${ui.button} ${ui.primary}`} disabled={busy || name.trim().length < 2}>
          {busy ? tc("sending") : t("submit")}
        </button>
      </form>
    </Screen>
  );
}
