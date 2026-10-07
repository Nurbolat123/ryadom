import { prisma, venuesNearPoint } from "@ryadom/db";
import {
  activeOfferWhere,
  countImpressions,
  offerSelect,
  popularHours,
  readActivity,
  toOfferView,
  topVenuesOfWeek,
  type OfferAudience,
  type OfferView,
} from "@ryadom/places";
import {
  activityRank,
  localTimeIn,
  type ActivityBucket,
  type PlacesQuerySchema,
} from "@ryadom/shared";
import { CITIES, OverpassVenueSource } from "@ryadom/venues";
import type { z } from "zod";
import { redis } from "../redis";

/**
 * «Где знакомятся сейчас»: заведения города с живой активностью (только диапазоны, < 3 не
 * показываем), популярными часами и предложениями заведений. Без людей, фото, пола и возраста,
 * без координат заведений. Реклама подбирается по контексту (город, категория, время), а по
 * интересам — только с согласия человека (offerAudience, правило 14).
 */

type Locale = "ru" | "kk";
const PAGE = 30;

export type PlaceItem = {
  slug: string;
  name: string;
  category: string;
  address: string | null;
  isPartner: boolean;
  activity: ActivityBucket | null;
  offer: { title: string; isAd: boolean; byInterests: boolean } | null;
  /** Только при сортировке «Рядом»: до заведения, округлено до 100 м. */
  distanceM?: number;
};

const cityName = (city: keyof typeof CITIES) => CITIES[city].name;

const startOfLocalDay = (now: Date) =>
  new Date(`${localTimeIn("Asia/Almaty", now).date}T00:00:00+05:00`);

export const listPlaces = async (
  q: z.infer<typeof PlacesQuerySchema>,
  locale: Locale,
  audience: OfferAudience = null,
  now = new Date(),
) => {
  const city = cityName(q.city as keyof typeof CITIES);
  const activity = await readActivity(redis);
  const category = q.category ?? null;

  let page: { id: string; distanceM?: number }[];
  let more: boolean;
  if (q.sort === "near" && q.near) {
    const rows = await venuesNearPoint(
      prisma,
      city,
      category,
      [q.near.lng, q.near.lat],
      PAGE + 1,
      q.offset,
    );
    more = rows.length > PAGE;
    page = rows.slice(0, PAGE);
  } else {
    // По активности: оживлённые выше, потом партнёры, потом места с предложениями, потом по алфавиту.
    const [all, withOffers] = await Promise.all([
      prisma.venue.findMany({
        where: { city, isActive: true, ...(category ? { category: category as never } : {}) },
        select: { id: true, name: true, isPartner: true },
      }),
      prisma.offer.findMany({
        where: { ...activeOfferWhere(now, audience), venue: { city } },
        select: { venueId: true },
      }),
    ]);
    const offered = new Set(withOffers.map((o) => o.venueId));
    all.sort(
      (a, b) =>
        activityRank(activity[b.id] ?? null) - activityRank(activity[a.id] ?? null) ||
        Number(b.isPartner) - Number(a.isPartner) ||
        Number(offered.has(b.id)) - Number(offered.has(a.id)) ||
        a.name.localeCompare(b.name, "ru"),
    );
    more = all.length > q.offset + PAGE;
    page = all.slice(q.offset, q.offset + PAGE).map((v) => ({ id: v.id }));
  }

  const ids = page.map((p) => p.id);
  const [venues, badges] = await Promise.all([
    prisma.venue.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true, name: true, category: true, address: true, isPartner: true },
    }),
    prisma.offer.findMany({
      where: { ...activeOfferWhere(now, audience), venueId: { in: ids }, placement: "badge" },
      select: { ...offerSelect, venueId: true },
      orderBy: [{ isPaid: "desc" }, { startsAt: "desc" }],
    }),
  ]);
  const byId = new Map(venues.map((v) => [v.id, v]));
  const badgeOf = new Map<string, (typeof badges)[number]>();
  for (const b of badges) if (!badgeOf.has(b.venueId)) badgeOf.set(b.venueId, b);

  const items: PlaceItem[] = page.flatMap(({ id, distanceM }) => {
    const v = byId.get(id);
    if (!v) return [];
    const badge = badgeOf.get(id);
    return [
      {
        slug: v.slug,
        name: v.name,
        category: v.category,
        address: v.address,
        isPartner: v.isPartner,
        activity: activity[id] ?? null,
        offer: badge
          ? (({ title, isAd, byInterests }) => ({ title, isAd, byInterests }))(
              toOfferView(badge, locale),
            )
          : null,
        ...(distanceM === undefined ? {} : { distanceM }),
      },
    ];
  });

  // Промо-карточка и событие дня — только на первой странице.
  let promos: OfferView[] = [];
  let event: OfferView | null = null;
  if (q.offset === 0) {
    const venueFilter = {
      city,
      isActive: true,
      ...(category ? { category: category as never } : {}),
    };
    const [promoRows, eventRow] = await Promise.all([
      prisma.offer.findMany({
        where: { ...activeOfferWhere(now, audience), placement: "promo_card", venue: venueFilter },
        select: offerSelect,
        orderBy: [{ isPaid: "desc" }, { startsAt: "desc" }],
        take: 2,
      }),
      prisma.offer.findFirst({
        where: {
          ...activeOfferWhere(now, audience),
          placement: "event_of_day",
          type: "event",
          // Событие дня — то, что заканчивается сегодня или завтра утром.
          endsAt: { gt: now, lte: new Date(startOfLocalDay(now).getTime() + 30 * 3600_000) },
          venue: venueFilter,
        },
        select: offerSelect,
        orderBy: [{ isPaid: "desc" }, { startsAt: "asc" }],
      }),
    ]);
    promos = promoRows.map((o) => toOfferView(o, locale));
    event = eventRow ? toOfferView(eventRow, locale) : null;
  }
  await countImpressions(prisma, [
    ...badges.filter((b) => badgeOf.get(b.venueId) === b).map((b) => b.id),
    ...promos.map((o) => o.id),
    ...(event ? [event.id] : []),
  ]);

  return {
    city: q.city,
    items,
    promos,
    event,
    nextOffset: more ? q.offset + PAGE : null,
    attribution: (({ text, textKk, license, url }) => ({
      text: locale === "kk" ? textKk : text,
      license,
      url,
    }))(new OverpassVenueSource().attribution),
  };
};

/** Страница заведения: активность, популярные часы, предложения. Людей и координат нет. */
export const placeDetails = async (
  slug: string,
  locale: Locale,
  audience: OfferAudience = null,
  now = new Date(),
) => {
  const v = await prisma.venue.findFirst({
    where: { slug, isActive: true },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      address: true,
      city: true,
      isPartner: true,
      timezone: true,
    },
  });
  if (!v) return null;
  const [activity, hours, offers] = await Promise.all([
    readActivity(redis),
    popularHours(prisma, v.id, v.timezone, now),
    prisma.offer.findMany({
      where: { ...activeOfferWhere(now, audience), venueId: v.id },
      select: offerSelect,
      orderBy: [{ isPaid: "desc" }, { startsAt: "desc" }],
    }),
  ]);
  await countImpressions(
    prisma,
    offers.map((o) => o.id),
  );
  return {
    slug: v.slug,
    name: v.name,
    category: v.category,
    address: v.address,
    city: v.city,
    isPartner: v.isPartner,
    activity: activity[v.id] ?? null,
    popularHours: hours,
    today: localTimeIn(v.timezone, now).weekday,
    offers: offers.map((o) => toOfferView(o, locale)),
  };
};

/** «Топ мест недели» для соцсетей: только порядок мест. */
export const topOfWeek = async (city: keyof typeof CITIES, now = new Date()) => {
  const ids = await topVenuesOfWeek(prisma, cityName(city), now);
  const venues = await prisma.venue.findMany({
    where: { id: { in: ids } },
    select: { id: true, slug: true, name: true, category: true, address: true, isPartner: true },
  });
  const byId = new Map(venues.map((v) => [v.id, v]));
  return ids.flatMap((id) => {
    const v = byId.get(id);
    return v
      ? [
          {
            slug: v.slug,
            name: v.name,
            category: v.category,
            address: v.address,
            isPartner: v.isPartner,
          },
        ]
      : [];
  });
};
