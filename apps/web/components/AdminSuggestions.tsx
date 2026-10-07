"use client";

import { VenueCategory } from "@ryadom/shared";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { osmLink, osmSearch, parseCoords } from "@/lib/client/coords";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Suggestion = {
  id: string;
  name: string;
  city: string;
  category: VenueCategory | null;
  address: string | null;
  comment: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  venueId: string | null;
};

/** «Нет моего заведения»: модератор ставит точку и одобряет или отклоняет. */
export function AdminSuggestions() {
  const t = useTranslations("adminVenues");
  const [items, setItems] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ suggestions: Suggestion[] }>("/api/admin/suggestions");
    if (r.ok) setItems(r.data.suggestions);
    else setError(r.error);
  }, []);
  useEffect(() => void load(), [load]);

  const pending = items?.filter((s) => s.status === "pending") ?? [];
  const reviewed = items?.filter((s) => s.status !== "pending") ?? [];

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("suggestionsTitle")}</h1>
      <AdminNav />
      <p className={ui.note}>{t("suggestionsHint")}</p>
      <ErrorText code={error} />
      {items && pending.length === 0 ? <p className={ui.hint}>{t("suggestionsEmpty")}</p> : null}
      <ul className={social.adminList}>
        {pending.map((s) => (
          <li key={s.id}>
            <SuggestionCard s={s} onDone={load} />
          </li>
        ))}
      </ul>
      {reviewed.length ? (
        <>
          <h2 className={social.sectionTitle}>{t("reviewed")}</h2>
          <ul className={social.adminList}>
            {reviewed.map((s) => (
              <li key={s.id} className={social.item}>
                <span className={social.itemName}>{s.name}</span>
                <span className={ui.note}>
                  {s.city} · {t(`suggestionStatus.${s.status}`)}
                </span>
                {s.venueId ? (
                  <Link href={`/admin/venues/${s.venueId}`} className={ui.link}>
                    {t("openVenue")}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function SuggestionCard({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const t = useTranslations("adminVenues");
  const tc = useTranslations("checkin.category");
  const format = useFormatter();
  const [name, setName] = useState(s.name);
  const [category, setCategory] = useState<VenueCategory | "">(s.category ?? "");
  const [coords, setCoords] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const point = parseCoords(coords);

  const decide = async (decision: "approved" | "rejected") => {
    setError(null);
    if (decision === "approved" && !point) return setError("bad_coords");
    if (decision === "approved" && !category) return setError("category_required");
    setBusy(true);
    const r = await api(`/api/admin/suggestions/${s.id}`, {
      json:
        decision === "approved"
          ? { decision, ...point, category, name: name.trim() || undefined }
          : { decision },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onDone();
  };

  return (
    <div className={`${ui.card} ${social.adminForm}`}>
      <span className={social.itemName}>{s.name}</span>
      <span className={ui.note}>
        {s.city}
        {s.address ? ` · ${s.address}` : ""} ·{" "}
        {format.dateTime(new Date(s.createdAt), { dateStyle: "medium" })}
      </span>
      {s.comment ? <p className={social.message}>{s.comment}</p> : null}
      <a
        className={ui.link}
        href={osmSearch([s.name, s.address, s.city].filter(Boolean).join(", "))}
        target="_blank"
        rel="noreferrer"
      >
        {t("findOnOsm")}
      </a>
      <label className={ui.field}>
        <span className={ui.label}>{t("name")}</span>
        <input
          className={ui.input}
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("category")}</span>
        <select
          className={ui.input}
          value={category}
          onChange={(e) => setCategory(e.target.value as VenueCategory)}
        >
          <option value="" disabled>
            {t("chooseCategory")}
          </option>
          {VenueCategory.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </select>
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("coords")}</span>
        <input
          className={ui.input}
          value={coords}
          inputMode="decimal"
          placeholder="43.2399, 76.9464"
          onChange={(e) => setCoords(e.target.value)}
        />
        <span className={ui.note}>{t("coordsHint")}</span>
        {point ? (
          <a
            className={ui.link}
            href={osmLink(point.lat, point.lng)}
            target="_blank"
            rel="noreferrer"
          >
            {t("openOsm")}
          </a>
        ) : null}
      </label>
      <ErrorText code={error} />
      <div className={social.adminRow}>
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          disabled={busy}
          onClick={() => void decide("rejected")}
        >
          {t("reject")}
        </button>
        <button
          type="button"
          className={`${ui.button} ${ui.primary}`}
          disabled={busy}
          onClick={() => void decide("approved")}
        >
          {t("approve")}
        </button>
      </div>
    </div>
  );
}
