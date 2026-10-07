"use client";

import { OfferPlacement, OfferType } from "@ryadom/shared";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { AdminNav } from "./AdminNav";
import { api } from "./api";
import { ErrorText } from "./ErrorText";
import social from "./social.module.css";
import ui from "./ui.module.css";

type Offer = {
  id: string;
  venueName: string;
  venueSlug: string;
  type: OfferType;
  placement: OfferPlacement;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  isPaid: boolean;
  status: "pending" | "approved" | "rejected";
  alcohol: boolean;
  interests: string[];
};
type Interest = { id: string; nameRu: string; nameKk: string };

/** datetime-local в часовом поясе браузера модератора. */
const localInput = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

const emptyForm = () => ({
  venueSlug: "",
  type: "discount" as OfferType,
  placement: "badge" as OfferPlacement,
  title: "",
  description: "",
  titleKk: "",
  descriptionKk: "",
  startsAt: localInput(new Date()),
  endsAt: localInput(new Date(Date.now() + 14 * 86_400_000)),
  isPaid: false,
  interestIds: [] as string[],
});

/** Предложения заведений: добавление и модерация (алкоголь не одобряется). */
export function AdminOffers() {
  const t = useTranslations("admin");
  const format = useFormatter();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [interests, setInterests] = useState<Interest[]>([]);
  const locale = useLocale();

  const load = useCallback(async () => {
    const r = await api<{ offers: Offer[] }>("/api/admin/offers");
    if (r.ok) setOffers(r.data.offers);
    else setError(r.error);
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    void api<{ interests: Interest[] }>("/api/interests").then(
      (r) => r.ok && setInterests(r.data.interests),
    );
  }, []);
  const toggleInterest = (id: string) =>
    setForm((f) => ({
      ...f,
      interestIds: f.interestIds.includes(id)
        ? f.interestIds.filter((i) => i !== id)
        : f.interestIds.length < 10
          ? [...f.interestIds, id]
          : f.interestIds,
    }));

  const set = <K extends keyof ReturnType<typeof emptyForm>>(
    k: K,
    v: ReturnType<typeof emptyForm>[K],
  ) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const r = await api("/api/admin/offers", {
      method: "POST",
      json: {
        ...form,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
      },
    });
    if (!r.ok) return setError(r.error);
    setForm(emptyForm());
    setSaved(true);
    void load();
  };

  const decide = async (o: Offer, decision: "approved" | "rejected") => {
    setError(null);
    const r = await api(`/api/admin/offers/${o.id}`, { json: { decision } });
    if (!r.ok) setError(r.error);
    void load();
  };

  const date = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const text = (k: "title" | "description" | "titleKk" | "descriptionKk", max: number) => (
    <label className={ui.field}>
      <span className={ui.label}>{t(`offer.${k}`)}</span>
      <input
        className={ui.input}
        value={form[k]}
        maxLength={max}
        required={k === "title"}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );

  return (
    <div className={ui.body}>
      <h1 className={ui.title}>{t("offersTitle")}</h1>
      <AdminNav />
      <p className={ui.note}>{t("offersHint")}</p>

      <form className={`${ui.card} ${social.adminForm}`} onSubmit={submit}>
        <h2 className={ui.label}>{t("offerNew")}</h2>
        <label className={ui.field}>
          <span className={ui.label}>{t("offer.venueSlug")}</span>
          <input
            className={ui.input}
            value={form.venueSlug}
            required
            placeholder="teplyi-ugol"
            onChange={(e) => set("venueSlug", e.target.value.trim())}
          />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t("offer.type")}</span>
          <select
            className={ui.input}
            value={form.type}
            onChange={(e) => set("type", e.target.value as OfferType)}
          >
            {OfferType.map((v) => (
              <option key={v} value={v}>
                {t(`offerType.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t("offer.placement")}</span>
          <select
            className={ui.input}
            value={form.placement}
            onChange={(e) => set("placement", e.target.value as OfferPlacement)}
          >
            {OfferPlacement.map((v) => (
              <option key={v} value={v}>
                {t(`offerPlacement.${v}`)}
              </option>
            ))}
          </select>
        </label>
        {text("title", 80)}
        {text("description", 500)}
        {text("titleKk", 80)}
        {text("descriptionKk", 500)}
        <label className={ui.field}>
          <span className={ui.label}>{t("offer.startsAt")}</span>
          <input
            type="datetime-local"
            className={ui.input}
            value={form.startsAt}
            required
            onChange={(e) => set("startsAt", e.target.value)}
          />
        </label>
        <label className={ui.field}>
          <span className={ui.label}>{t("offer.endsAt")}</span>
          <input
            type="datetime-local"
            className={ui.input}
            value={form.endsAt}
            required
            onChange={(e) => set("endsAt", e.target.value)}
          />
        </label>
        <fieldset className={social.adminFieldset}>
          <legend className={ui.label}>{t("offer.interests")}</legend>
          <p className={ui.note}>{t("offer.interestsHint")}</p>
          <div className={ui.chips}>
            {interests.map((i) => (
              <button
                key={i.id}
                type="button"
                className={ui.chip}
                aria-pressed={form.interestIds.includes(i.id)}
                onClick={() => toggleInterest(i.id)}
              >
                {locale === "kk" ? i.nameKk : i.nameRu}
              </button>
            ))}
          </div>
        </fieldset>
        <label className={social.check}>
          <input
            type="checkbox"
            checked={form.isPaid}
            onChange={(e) => set("isPaid", e.target.checked)}
          />
          <span>{t("offer.isPaid")}</span>
        </label>
        <ErrorText code={error} />
        {saved ? <p className={ui.note}>{t("offerSaved")}</p> : null}
        <button type="submit" className={`${ui.button} ${ui.primary}`}>
          {t("offerCreate")}
        </button>
      </form>

      {offers?.length === 0 ? <p className={ui.hint}>{t("offersEmpty")}</p> : null}
      <ul className={`${social.section} ${social.adminList}`}>
        {offers?.map((o) => (
          <li key={o.id} className={social.item}>
            <div className={social.itemText}>
              <span className={social.itemName}>{o.title}</span>
              <span className={ui.note}>
                {o.venueName} · {t(`offerType.${o.type}`)} · {t(`offerPlacement.${o.placement}`)}
                {o.isPaid ? ` · ${t("offerPaid")}` : ""}
              </span>
              <span className={ui.note}>
                {date(o.startsAt)} — {date(o.endsAt)}
              </span>
              {o.interests.length ? (
                <span className={ui.note}>
                  {t("offerInterests", { list: o.interests.join(", ") })}
                </span>
              ) : null}
              <span className={ui.note}>{t(`offerStatus.${o.status}`)}</span>
            </div>
            {o.description ? <p className={social.message}>{o.description}</p> : null}
            {o.alcohol ? (
              <p className={ui.error} role="alert">
                {t("offerAlcohol")}
              </p>
            ) : null}
            {o.status === "pending" ? (
              <div className={social.adminActions}>
                <button
                  className={`${ui.button} ${ui.secondary}`}
                  onClick={() => decide(o, "rejected")}
                >
                  {t("offerReject")}
                </button>
                {o.alcohol ? null : (
                  <button
                    className={`${ui.button} ${ui.primary}`}
                    onClick={() => decide(o, "approved")}
                  >
                    {t("offerApprove")}
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
