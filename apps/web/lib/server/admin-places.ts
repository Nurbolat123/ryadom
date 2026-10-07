import { prisma } from "@ryadom/db";
import { partnerReport } from "@ryadom/places";
import { offerMentionsAlcohol, type OfferInputSchema } from "@ryadom/shared";
import type { z } from "zod";

/** Админка этапа 11: предложения заведений, отчёт партнёрам, воронка. Только агрегаты. */

export const listOffers = async () => {
  const offers = await prisma.offer.findMany({
    where: { endsAt: { gt: new Date(Date.now() - 30 * 86_400_000) } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: { venue: { select: { name: true, slug: true } } },
    take: 200,
  });
  return offers.map((o) => ({
    id: o.id,
    venueName: o.venue.name,
    venueSlug: o.venue.slug,
    type: o.type,
    placement: o.placement,
    title: o.title,
    description: o.description,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    isPaid: o.isPaid,
    status: o.status,
    alcohol: offerMentionsAlcohol(o),
  }));
};

export const createOffer = async (input: z.infer<typeof OfferInputSchema>) => {
  const venue = await prisma.venue.findFirst({
    where: { slug: input.venueSlug, isActive: true },
    select: { id: true },
  });
  if (!venue) return { ok: false as const, error: "not_found" as const };
  const o = await prisma.offer.create({
    data: {
      venueId: venue.id,
      type: input.type,
      placement: input.placement,
      title: input.title,
      description: input.description || null,
      titleKk: input.titleKk || null,
      descriptionKk: input.descriptionKk || null,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      isPaid: input.isPaid,
      status: "pending",
    },
    select: { id: true },
  });
  return { ok: true as const, id: o.id };
};

/** Отчёт по заведениям с предложениями и партнёрам за 30 дней. */
export const partnersReport = async (days = 30) => {
  const venues = await prisma.venue.findMany({
    where: { OR: [{ isPartner: true }, { offers: { some: {} } }] },
    select: { id: true, name: true, isPartner: true },
    orderBy: { name: "asc" },
  });
  const from = new Date(Date.now() - days * 86_400_000);
  return Promise.all(
    venues.map(async (v) => {
      const [r, checkins] = await Promise.all([
        partnerReport(prisma, v.id, days),
        prisma.venueStatsHourly.aggregate({
          where: { venueId: v.id, date: { gte: from } },
          _sum: { checkins: true },
        }),
      ]);
      return {
        venueName: v.name,
        isPartner: v.isPartner,
        ...r,
        checkins: checkins._sum.checkins ?? 0,
      };
    }),
  );
};

export const FUNNEL_STEPS = [
  "app_open",
  "registered",
  "checkin",
  "open_to_meet_on",
  "sympathy_sent",
  "hello_sent",
  "super_hello_sent",
  "gift_sent",
  "match",
  "hello_replied",
  "gift_accepted",
  "gift_redeemed",
] as const;

/**
 * Воронка по заведению и дню. Открытие приложения и регистрация не привязаны к заведению
 * (строка «Без заведения»). Только счётчики событий — без людей.
 */
export const funnel = async (days: number) => {
  const from = new Date(Date.now() - days * 86_400_000);
  const rows = await prisma.analyticsEvent.groupBy({
    by: ["day", "venueId", "type"],
    where: { day: { gte: new Date(from.toISOString().slice(0, 10)) } },
    _count: { _all: true },
  });
  const venueIds = [...new Set(rows.map((r) => r.venueId).filter((v): v is string => !!v))];
  const names = new Map(
    (
      await prisma.venue.findMany({
        where: { id: { in: venueIds } },
        select: { id: true, name: true },
      })
    ).map((v) => [v.id, v.name]),
  );
  const table = new Map<
    string,
    { day: string; venueName: string | null; counts: Record<string, number> }
  >();
  for (const r of rows) {
    const day = r.day.toISOString().slice(0, 10);
    const key = `${day}|${r.venueId ?? ""}`;
    const row = table.get(key) ?? {
      day,
      venueName: r.venueId ? (names.get(r.venueId) ?? "—") : null,
      counts: Object.fromEntries(FUNNEL_STEPS.map((s) => [s, 0])),
    };
    row.counts[r.type] = r._count._all;
    table.set(key, row);
  }
  return [...table.values()].sort(
    (a, b) =>
      b.day.localeCompare(a.day) || (a.venueName ?? "").localeCompare(b.venueName ?? "", "ru"),
  );
};
