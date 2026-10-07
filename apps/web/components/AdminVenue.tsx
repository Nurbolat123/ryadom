"use client";

import { GEOFENCE_RADIUS_M, VenueCategory } from "@ryadom/shared";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatCoords, osmLink, parseCoords } from "@/lib/client/coords";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import { GeofencePreview } from "./GeofencePreview";
import social from "./social.module.css";
import ui from "./ui.module.css";

type MenuItem = {
  id: string;
  name: string;
  nameKk: string | null;
  price: number;
  isAlcohol: boolean;
  giftable: boolean;
  isAvailable: boolean;
  sortOrder: number;
};
type Venue = {
  id: string;
  slug: string;
  name: string;
  category: VenueCategory;
  address: string | null;
  city: string;
  source: string;
  sourceId: string | null;
  isActive: boolean;
  isPartner: boolean;
  geofenceKind: "building" | "circle" | "manual";
  telegramLinked: boolean;
  commissionPct: number | null;
  maxGiftAmount: number | null;
  defaults: { commissionPct: number; maxGiftAmount: number };
  currency: string;
  geometry: { location: [number, number]; ring: [number, number][]; areaM2: number } | null;
  menu: MenuItem[];
};

/** Заведение в админке: настройки и партнёрство, геозона, Telegram персонала, меню. */
export function AdminVenue({ id }: { id: string }) {
  const t = useTranslations("adminVenues");
  const [venue, setVenue] = useState<Venue | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ venue: Venue }>(`/api/admin/venues/${id}`);
    if (r.ok) setVenue(r.data.venue);
    else setError(r.error);
  }, [id]);
  useEffect(() => void load(), [load]);

  return (
    <div className={ui.body}>
      <Link href="/admin/venues" className={ui.link}>
        {t("back")}
      </Link>
      <h1 className={ui.title}>{venue?.name ?? t("title")}</h1>
      <AdminNav />
      <ErrorText code={error} />
      {venue ? (
        <>
          <p className={ui.note}>
            /v/{venue.slug} · {t(`source.${venue.source}`)}
            {venue.sourceId ? ` (${venue.sourceId})` : ""}
          </p>
          <SettingsForm venue={venue} onSaved={load} />
          <GeofenceForm venue={venue} onSaved={load} />
          {venue.isPartner ? <TelegramCard venue={venue} /> : null}
          <MenuCard venue={venue} onChanged={load} />
        </>
      ) : null}
    </div>
  );
}

function SettingsForm({ venue, onSaved }: { venue: Venue; onSaved: () => void }) {
  const t = useTranslations("adminVenues");
  const tc = useTranslations("checkin.category");
  const [form, setForm] = useState({
    name: venue.name,
    category: venue.category,
    address: venue.address ?? "",
    isActive: venue.isActive,
    isPartner: venue.isPartner,
    commissionPct: venue.commissionPct?.toString() ?? "",
    maxGiftAmount: venue.maxGiftAmount?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (venue.isActive && !form.isActive && !window.confirm(t("deactivateConfirm"))) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await api(`/api/admin/venues/${venue.id}`, {
      method: "PATCH",
      json: {
        name: form.name,
        category: form.category,
        address: form.address.trim() || null,
        isActive: form.isActive,
        isPartner: form.isPartner,
        commissionPct: form.commissionPct === "" ? null : Number(form.commissionPct),
        maxGiftAmount: form.maxGiftAmount === "" ? null : Number(form.maxGiftAmount),
      },
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(true);
    onSaved();
  };

  return (
    <form className={`${ui.card} ${social.adminForm}`} onSubmit={submit}>
      <h2 className={social.sectionTitle}>{t("settings")}</h2>
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
      <label className={social.check}>
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
        />
        <span>{t("isActive")}</span>
      </label>
      {venue.source === "osm" ? <p className={ui.note}>{t("isActiveOsmHint")}</p> : null}
      <label className={social.check}>
        <input
          type="checkbox"
          checked={form.isPartner}
          onChange={(e) => setForm({ ...form, isPartner: e.target.checked })}
        />
        <span>{t("isPartner")}</span>
      </label>
      <p className={ui.note}>{t("isPartnerHint")}</p>
      {form.isPartner ? (
        <>
          <label className={ui.field}>
            <span className={ui.label}>{t("commission")}</span>
            <input
              className={ui.input}
              type="number"
              min={0}
              max={50}
              step={0.5}
              value={form.commissionPct}
              placeholder={String(venue.defaults.commissionPct)}
              onChange={(e) => setForm({ ...form, commissionPct: e.target.value })}
            />
            <span className={ui.note}>
              {t("defaultHint", { value: `${venue.defaults.commissionPct}%` })}
            </span>
          </label>
          <label className={ui.field}>
            <span className={ui.label}>{t("maxGift")}</span>
            <input
              className={ui.input}
              type="number"
              min={100}
              max={100000}
              step={1}
              value={form.maxGiftAmount}
              placeholder={String(venue.defaults.maxGiftAmount)}
              onChange={(e) => setForm({ ...form, maxGiftAmount: e.target.value })}
            />
            <span className={ui.note}>
              {t("defaultHint", { value: `${venue.defaults.maxGiftAmount} ₸` })}
            </span>
          </label>
        </>
      ) : null}
      <ErrorText code={error} />
      {saved ? (
        <p className={ui.note} role="status">
          {t("saved")}
        </p>
      ) : null}
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={busy}>
        {t("save")}
      </button>
    </form>
  );
}

function GeofenceForm({ venue, onSaved }: { venue: Venue; onSaved: () => void }) {
  const t = useTranslations("adminVenues");
  const g = venue.geometry;
  const [coords, setCoords] = useState(g ? formatCoords(g.location[1], g.location[0]) : "");
  const [radius, setRadius] = useState(35);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const point = parseCoords(coords);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!point) return setError("bad_coords");
    setError(null);
    setSaved(false);
    const r = await api(`/api/admin/venues/${venue.id}/geofence`, {
      method: "PUT",
      json: { ...point, radiusM: radius },
    });
    if (!r.ok) return setError(r.error);
    setSaved(true);
    onSaved();
  };

  const release = async () => {
    setError(null);
    const r = await api(`/api/admin/venues/${venue.id}/geofence`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    onSaved();
  };

  return (
    <form className={`${ui.card} ${social.adminForm}`} onSubmit={save}>
      <h2 className={social.sectionTitle}>{t("geofenceTitle")}</h2>
      <p className={ui.note}>
        {t(`geofenceKind.${venue.geofenceKind}`)}
        {g ? ` · ${t("area", { area: g.areaM2 })}` : ""}
      </p>
      {g ? (
        <GeofencePreview
          ring={g.ring}
          center={g.location}
          proposed={point ? { lng: point.lng, lat: point.lat, radiusM: radius } : null}
          label={t("previewLabel")}
          meters={(n) => t("meters", { n })}
        />
      ) : null}
      <p className={ui.note}>{t("previewLegend")}</p>
      <label className={ui.field}>
        <span className={ui.label}>{t("coords")}</span>
        <input
          className={ui.input}
          value={coords}
          inputMode="decimal"
          onChange={(e) => setCoords(e.target.value)}
        />
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
      <label className={ui.field}>
        <span className={ui.label}>{t("radius", { radius })}</span>
        <input
          type="range"
          min={GEOFENCE_RADIUS_M.min}
          max={GEOFENCE_RADIUS_M.max}
          step={5}
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
        />
        <span className={ui.note}>{t("radiusHint")}</span>
      </label>
      <ErrorText code={error} />
      {saved ? (
        <p className={ui.note} role="status">
          {t("geofenceSaved")}
        </p>
      ) : null}
      <button type="submit" className={`${ui.button} ${ui.primary}`} disabled={!point}>
        {t("geofenceSave")}
      </button>
      {venue.geofenceKind === "manual" && venue.source === "osm" ? (
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          onClick={() => void release()}
        >
          {t("geofenceRelease")}
        </button>
      ) : null}
    </form>
  );
}

function TelegramCard({ venue }: { venue: Venue }) {
  const t = useTranslations("adminVenues");
  const [code, setCode] = useState<string | null>(null);
  const [linked, setLinked] = useState(venue.telegramLinked);
  const [error, setError] = useState<string | null>(null);

  const issue = async () => {
    setError(null);
    const r = await api<{ code: string }>(`/api/admin/venues/${venue.id}/telegram`, {
      method: "POST",
    });
    if (r.ok) setCode(r.data.code);
    else setError(r.error);
  };
  const unlink = async () => {
    if (!window.confirm(t("unlinkConfirm"))) return;
    const r = await api(`/api/admin/venues/${venue.id}/telegram`, { method: "DELETE" });
    if (r.ok) setLinked(false);
    else setError(r.error);
  };

  return (
    <section className={`${ui.card} ${social.adminForm}`}>
      <h2 className={social.sectionTitle}>{t("telegramTitle")}</h2>
      <p className={ui.note}>{linked ? t("telegramLinked") : t("telegramNotLinked")}</p>
      {code ? (
        <>
          <p className={social.code}>{code}</p>
          <p className={ui.note}>{t("telegramHowTo", { code })}</p>
        </>
      ) : null}
      <ErrorText code={error} />
      <button type="button" className={`${ui.button} ${ui.secondary}`} onClick={() => void issue()}>
        {linked ? t("telegramRelink") : t("telegramLink")}
      </button>
      {linked ? (
        <button type="button" className={ui.link} onClick={() => void unlink()}>
          {t("telegramUnlink")}
        </button>
      ) : null}
    </section>
  );
}

const emptyItem = () => ({
  name: "",
  nameKk: "",
  price: "",
  isAlcohol: false,
  giftable: true,
  isAvailable: true,
});
type ItemForm = ReturnType<typeof emptyItem>;

function MenuCard({ venue, onChanged }: { venue: Venue; onChanged: () => void }) {
  const t = useTranslations("adminVenues");
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async (item: MenuItem) => {
    if (!window.confirm(t("menuDeleteConfirm", { name: item.name }))) return;
    setError(null);
    const r = await api(`/api/admin/venues/${venue.id}/menu/${item.id}`, { method: "DELETE" });
    if (!r.ok) return setError(r.error);
    onChanged();
  };

  return (
    <section className={`${ui.card} ${social.adminForm}`}>
      <h2 className={social.sectionTitle}>{t("menuTitle")}</h2>
      <p className={ui.note}>{venue.isPartner ? t("menuHint") : t("menuNotPartner")}</p>
      <ErrorText code={error} />
      <ul className={social.adminList}>
        {venue.menu.map((m) =>
          editing === m.id ? (
            <li key={m.id}>
              <MenuItemForm
                venueId={venue.id}
                item={m}
                onDone={() => {
                  setEditing(null);
                  onChanged();
                }}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={m.id} className={social.menuItem}>
              <span className={social.itemText}>
                <span className={social.itemName}>{m.name}</span>
                <span className={social.adminTags}>
                  {m.giftable ? <span className={social.tagPartner}>{t("giftable")}</span> : null}
                  {m.isAlcohol ? <span className={social.tagOff}>{t("alcohol")}</span> : null}
                  {!m.isAvailable ? (
                    <span className={social.tagOff}>{t("unavailable")}</span>
                  ) : null}
                </span>
              </span>
              <span className={social.adminItemSide}>
                <span className={social.price}>
                  {m.price} {venue.currency === "KZT" ? "₸" : venue.currency}
                </span>
                <button type="button" className={ui.link} onClick={() => setEditing(m.id)}>
                  {t("edit")}
                </button>
                <button type="button" className={ui.link} onClick={() => void remove(m)}>
                  {t("delete")}
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
      {editing === "new" ? (
        <MenuItemForm
          venueId={venue.id}
          item={null}
          onDone={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button
          type="button"
          className={`${ui.button} ${ui.secondary}`}
          onClick={() => setEditing("new")}
        >
          {t("menuAdd")}
        </button>
      )}
    </section>
  );
}

function MenuItemForm({
  venueId,
  item,
  onDone,
  onCancel,
}: {
  venueId: string;
  item: MenuItem | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("adminVenues");
  const [form, setForm] = useState<ItemForm>(
    item
      ? {
          name: item.name,
          nameKk: item.nameKk ?? "",
          price: String(item.price),
          isAlcohol: item.isAlcohol,
          giftable: item.giftable,
          isAvailable: item.isAvailable,
        }
      : emptyItem(),
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const r = await api(
      item ? `/api/admin/venues/${venueId}/menu/${item.id}` : `/api/admin/venues/${venueId}/menu`,
      {
        method: item ? "PATCH" : "POST",
        json: {
          name: form.name,
          nameKk: form.nameKk.trim() || null,
          price: Number(form.price),
          isAlcohol: form.isAlcohol,
          giftable: form.giftable && !form.isAlcohol,
          isAvailable: form.isAvailable,
        },
      },
    );
    if (!r.ok) return setError(r.error);
    onDone();
  };

  const check = (k: "isAlcohol" | "giftable" | "isAvailable", disabled = false) => (
    <label className={social.check}>
      <input
        type="checkbox"
        checked={form[k] && !disabled}
        disabled={disabled}
        onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
      />
      <span>{t(`item.${k}`)}</span>
    </label>
  );

  return (
    <form className={social.adminForm} onSubmit={submit}>
      <label className={ui.field}>
        <span className={ui.label}>{t("item.name")}</span>
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
        <span className={ui.label}>{t("item.nameKk")}</span>
        <input
          className={ui.input}
          value={form.nameKk}
          maxLength={80}
          onChange={(e) => setForm({ ...form, nameKk: e.target.value })}
        />
      </label>
      <label className={ui.field}>
        <span className={ui.label}>{t("item.price")}</span>
        <input
          className={ui.input}
          type="number"
          min={1}
          step={1}
          required
          value={form.price}
          onChange={(e) => setForm({ ...form, price: e.target.value })}
        />
      </label>
      {check("isAlcohol")}
      {check("giftable", form.isAlcohol)}
      {form.isAlcohol ? <p className={ui.note}>{t("item.alcoholHint")}</p> : null}
      {check("isAvailable")}
      <ErrorText code={error} />
      <div className={social.adminRow}>
        <button type="button" className={`${ui.button} ${ui.secondary}`} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={`${ui.button} ${ui.primary}`}>
          {t("save")}
        </button>
      </div>
    </form>
  );
}
