"use client";

import { VenueCategory } from "@ryadom/shared";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { parseCoords } from "@/lib/client/coords";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type City = { slug: string; name: string };
type Venue = {
  id: string;
  slug: string;
  name: string;
  category: VenueCategory;
  address: string | null;
  city: string;
  isActive: boolean;
  isPartner: boolean;
  geofenceKind: "building" | "circle" | "manual";
  source: string;
  menuItems: number;
  telegramLinked: boolean;
};
type List = { total: number; pageSize: number; venues: Venue[]; cities: City[] };
type Run = {
  id: string;
  city: string;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  fetched: number;
  created: number;
  updated: number;
  deactivated: number;
  error: string | null;
};

const FILTERS = ["all", "partners", "inactive", "manual"] as const;

/** Заведения: импорт из OpenStreetMap, поиск, добавление вручную. */
export function AdminVenues() {
  const t = useTranslations("adminVenues");
  const tc = useTranslations("checkin.category");
  const format = useFormatter();
  const [city, setCity] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [page, setPage] = useState(0);
  const [list, setList] = useState<List | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [importCity, setImportCity] = useState("almaty");
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ filter, page: String(page) });
    if (city) params.set("city", city);
    if (q.trim()) params.set("q", q.trim());
    const r = await api<List>(`/api/admin/venues?${params}`);
    if (r.ok) setList(r.data);
    else setError(r.error);
  }, [city, q, filter, page]);

  const loadRuns = useCallback(async () => {
    const r = await api<{ runs: Run[] }>("/api/admin/imports");
    if (r.ok) setRuns(r.data.runs);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  useEffect(() => void loadRuns(), [loadRuns]);

  // Пока импорт идёт, журнал обновляется сам.
  const running = runs.some((r) => r.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void loadRuns().then(load), 5000);
    return () => clearInterval(timer);
  }, [running, loadRuns, load]);

  const runImport = async () => {
    setError(null);
    const r = await api("/api/admin/imports", { json: { city: importCity } });
    if (!r.ok) return setError(r.error);
    setTimeout(() => void loadRuns(), 500);
  };

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("title")}</h1>
      <AdminNav />

      <section className={`${ui.card} ${social.adminForm}`}>
        <h2 className={social.sectionTitle}>{t("importTitle")}</h2>
        <p className={ui.note}>{t("importHint")}</p>
        <div className={social.adminRow}>
          <select
            className={ui.input}
            value={importCity}
            aria-label={t("city")}
            onChange={(e) => setImportCity(e.target.value)}
          >
            {(list?.cities ?? []).map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`${ui.button} ${ui.secondary}`}
            disabled={running}
            onClick={() => void runImport()}
          >
            {running ? t("importRunning") : t("importRun")}
          </button>
        </div>
        {runs.length ? (
          <ul className={social.adminLog}>
            {runs.slice(0, 5).map((r) => (
              <li key={r.id}>
                <strong>
                  {r.city} · {date(r.startedAt)} · {t(`importStatus.${r.status}`)}
                </strong>
                {r.status === "success" ? (
                  <span>
                    {t("importResult", {
                      fetched: r.fetched,
                      created: r.created,
                      updated: r.updated,
                      deactivated: r.deactivated,
                    })}
                  </span>
                ) : null}
                {r.error ? <span className={ui.note}>{r.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <div className={social.adminRow}>
        <input
          className={ui.input}
          type="search"
          value={q}
          placeholder={t("search")}
          aria-label={t("search")}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
        />
        <select
          className={ui.input}
          value={city}
          aria-label={t("city")}
          onChange={(e) => {
            setCity(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("allCities")}</option>
          {(list?.cities ?? []).map((c) => (
            <option key={c.slug} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className={ui.chips}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            className={ui.chip}
            aria-pressed={filter === f}
            onClick={() => {
              setFilter(f);
              setPage(0);
            }}
          >
            {t(`filter.${f}`)}
          </button>
        ))}
      </div>
      <ErrorText code={error} />

      {adding ? (
        <NewVenueForm onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          onClick={() => setAdding(true)}
        >
          {t("add")}
        </button>
      )}

      {list ? <p className={ui.note}>{t("found", { count: list.total })}</p> : null}
      <ul className={social.adminList}>
        {list?.venues.map((v) => (
          <li key={v.id}>
            <Link href={`/admin/venues/${v.id}`} className={`${social.item} ${social.adminVenue}`}>
              <span className={social.itemName}>{v.name}</span>
              <span className={ui.note}>
                {tc(v.category)} · {v.city}
                {v.address ? ` · ${v.address}` : ""}
              </span>
              <span className={social.adminTags}>
                {v.isPartner ? <span className={social.tagPartner}>{t("partner")}</span> : null}
                {!v.isActive ? <span className={social.tagOff}>{t("inactive")}</span> : null}
                <span className={social.tag}>{t(`geofence.${v.geofenceKind}`)}</span>
                {v.isPartner ? (
                  <span className={social.tag}>{t("menuCount", { count: v.menuItems })}</span>
                ) : null}
                {v.isPartner && !v.telegramLinked ? (
                  <span className={social.tagOff}>{t("noTelegram")}</span>
                ) : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {list && list.total > list.pageSize ? (
        <div className={social.adminRow}>
          <button
            type="button"
            className={`${ui.button} ${ui.secondary}`}
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            {t("prev")}
          </button>
          <button
            type="button"
            className={`${ui.button} ${ui.secondary}`}
            disabled={(page + 1) * list.pageSize >= list.total}
            onClick={() => setPage((p) => p + 1)}
          >
            {t("next")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Добавить заведение вручную: название, категория, адрес, координаты (город — по точке). */
function NewVenueForm({ onCancel }: { onCancel: () => void }) {
  const t = useTranslations("adminVenues");
  const tc = useTranslations("checkin.category");
  const [form, setForm] = useState({
    name: "",
    category: "cafe" as VenueCategory,
    address: "",
    coords: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const point = parseCoords(form.coords);
    if (!point) return setError("bad_coords");
    setBusy(true);
    const r = await api<{ id: string }>("/api/admin/venues", {
      json: {
        name: form.name,
        category: form.category,
        address: form.address || undefined,
        ...point,
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    window.location.assign(`/admin/venues/${r.data.id}`);
  };

  return (
    <form className={`${ui.card} ${social.adminForm}`} onSubmit={submit}>
      <h2 className={social.sectionTitle}>{t("addTitle")}</h2>
      <label className={ui.field}>
        <span className={ui.label}>{t("name")}</span>
        <input
          className={ui.input}
          value={form.name}
          required
          minLength={2}
          maxLength={80}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("category")}</span>
        <select
          className={ui.input}
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value as VenueCategory })}
        >
          {VenueCategory.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </select>
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("address")}</span>
        <input
          className={ui.input}
          value={form.address}
          maxLength={200}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("coords")}</span>
        <input
          className={ui.input}
          value={form.coords}
          required
          inputMode="decimal"
          placeholder="43.2399, 76.9464"
          onChange={(e) => setForm({ ...form, coords: e.target.value })}
        />
        <span className={ui.note}>{t("coordsHint")}</span>
      </label>
      <ErrorText code={error} />
      <div className={social.adminRow}>
        <button type="button" className={`${ui.button} ${ui.secondary}`} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
          {t("create")}
        </button>
      </div>
    </form>
  );
}
