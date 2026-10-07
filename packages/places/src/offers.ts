import { randomInt } from "node:crypto";
import type { OfferPlacement, PrismaClient } from "@ryadom/db";
import { localTimeIn, offerMentionsAlcohol } from "@ryadom/shared";

/**
 * Предложения заведений: скидки, акции, события.
 * - Показываются только одобренные модератором и только в своё время.
 * - Платное размещение помечается «Реклама».
 * - Подбор только по контексту (город, категория, время, заведение). Поведение в знакомствах
 *   и интересы не используются (правило 14); показы и переходы считаются без людей.
 * - Реклама алкоголя запрещена: такое предложение нельзя одобрить.
 */

export const activeOfferWhere = (now = new Date()) => ({
  status: "approved" as const,
  startsAt: { lte: now },
  endsAt: { gt: now },
});

export type OfferView = {
  id: string;
  venueSlug: string;
  venueName: string;
  type: "discount" | "event" | "promo";
  placement: OfferPlacement;
  title: string;
  description: string | null;
  endsAt: string;
  /** Платное размещение — «Реклама». */
  isAd: boolean;
};

type OfferRow = {
  id: string;
  type: "discount" | "event" | "promo";
  placement: OfferPlacement;
  title: string;
  titleKk: string | null;
  description: string | null;
  descriptionKk: string | null;
  endsAt: Date;
  isPaid: boolean;
  venue: { slug: string; name: string };
};

export const offerSelect = {
  id: true,
  type: true,
  placement: true,
  title: true,
  titleKk: true,
  description: true,
  descriptionKk: true,
  endsAt: true,
  isPaid: true,
  venue: { select: { slug: true, name: true } },
} as const;

export const toOfferView = (o: OfferRow, locale: "ru" | "kk"): OfferView => ({
  id: o.id,
  venueSlug: o.venue.slug,
  venueName: o.venue.name,
  type: o.type,
  placement: o.placement,
  title: (locale === "kk" && o.titleKk) || o.title,
  description: (locale === "kk" && o.descriptionKk) || o.description,
  endsAt: o.endsAt.toISOString(),
  isAd: o.isPaid,
});

const today = () => new Date(`${localTimeIn("Asia/Almaty").date}T00:00:00Z`);

/** Показ предложений (для отчёта партнёру). Один запрос на пачку. */
export const countImpressions = async (db: PrismaClient, offerIds: string[]) => {
  if (!offerIds.length) return;
  const day = today();
  await db.$executeRaw`
    INSERT INTO "OfferStatsDaily" ("offerId", "day", "impressions", "clicks")
    SELECT id, ${day}::date, 1, 0 FROM unnest(${offerIds}::text[]) AS id
    ON CONFLICT ("offerId", "day")
    DO UPDATE SET "impressions" = "OfferStatsDaily"."impressions" + 1`;
};

export const countClick = async (db: PrismaClient, offerId: string) => {
  await db.$executeRaw`
    INSERT INTO "OfferStatsDaily" ("offerId", "day", "impressions", "clicks")
    VALUES (${offerId}, ${today()}::date, 0, 1)
    ON CONFLICT ("offerId", "day")
    DO UPDATE SET "clicks" = "OfferStatsDaily"."clicks" + 1`;
};

/** Код для стойки: 6 знаков без похожих символов (0/O, 1/I). */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const newOfferCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/**
 * Выдать код скидки. Код не связан с человеком (правило 14): в базе только предложение,
 * код и срок. Код действует до конца предложения.
 */
export const issueOfferCode = async (db: PrismaClient, offerId: string, now = new Date()) => {
  const offer = await db.offer.findFirst({
    where: { id: offerId, type: "discount", ...activeOfferWhere(now) },
    select: { id: true, endsAt: true },
  });
  if (!offer) return null;
  for (let i = 0; i < 5; i++) {
    try {
      const r = await db.offerRedemption.create({
        data: { offerId, code: newOfferCode(), expiresAt: offer.endsAt },
        select: { code: true, expiresAt: true },
      });
      await countClick(db, offerId);
      return r;
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
  }
  throw new Error("offer code collision");
};

export type RedeemResult =
  { ok: true; title: string } | { ok: false; error: "not_found" | "used" | "expired" };

/** Погасить код у стойки (Telegram-бот заведения). Чужой код (другого заведения) — «не найден». */
export const redeemOfferCode = async (
  db: PrismaClient,
  venueId: string,
  rawCode: string,
  now = new Date(),
): Promise<RedeemResult> => {
  const code = rawCode.trim().toUpperCase();
  const r = await db.offerRedemption.findUnique({
    where: { code },
    select: {
      id: true,
      redeemedAt: true,
      expiresAt: true,
      offer: { select: { venueId: true, title: true } },
    },
  });
  if (!r || r.offer.venueId !== venueId) return { ok: false, error: "not_found" };
  if (r.redeemedAt) return { ok: false, error: "used" };
  if (r.expiresAt <= now) return { ok: false, error: "expired" };
  const done = await db.offerRedemption.updateMany({
    where: { id: r.id, redeemedAt: null },
    data: { redeemedAt: now },
  });
  if (done.count !== 1) return { ok: false, error: "used" };
  return { ok: true, title: r.offer.title };
};

/** Одобрить предложение. Алкоголь — нельзя (законодательство РК). */
export const moderateOffer = async (
  db: PrismaClient,
  offerId: string,
  decision: "approved" | "rejected",
) => {
  const o = await db.offer.findUnique({ where: { id: offerId } });
  if (!o) return { ok: false as const, error: "not_found" as const };
  if (decision === "approved" && offerMentionsAlcohol(o))
    return { ok: false as const, error: "alcohol" as const };
  await db.offer.update({ where: { id: offerId }, data: { status: decision } });
  return { ok: true as const };
};

/** Отчёт партнёру: показы, переходы, выданные и погашенные коды за период. Без данных о людях. */
export const partnerReport = async (
  db: PrismaClient,
  venueId: string,
  days: number,
  now = new Date(),
) => {
  const from = new Date(now.getTime() - days * 86_400_000);
  const [stats, issued, redeemed] = await Promise.all([
    db.offerStatsDaily.aggregate({
      where: { offer: { venueId }, day: { gte: from } },
      _sum: { impressions: true, clicks: true },
    }),
    db.offerRedemption.count({ where: { offer: { venueId }, createdAt: { gte: from } } }),
    db.offerRedemption.count({ where: { offer: { venueId }, redeemedAt: { gte: from } } }),
  ]);
  return {
    impressions: stats._sum.impressions ?? 0,
    clicks: stats._sum.clicks ?? 0,
    codesIssued: issued,
    redemptions: redeemed,
  };
};
