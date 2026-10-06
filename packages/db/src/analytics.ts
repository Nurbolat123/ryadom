import { todayIn } from "@ryadom/shared";
import type { AnalyticsEventType, PrismaClient } from "./generated/prisma/client";

/** Обезличенное событие воронки: тип, заведение, местный день. Без пользователя и текстов. */
export const trackEvent = async (
  db: PrismaClient,
  type: AnalyticsEventType,
  venueId: string | null,
) => {
  const venue = venueId
    ? await db.venue.findUnique({ where: { id: venueId }, select: { timezone: true } })
    : null;
  await db.analyticsEvent.create({
    data: { type, venueId, day: new Date(`${todayIn(venue?.timezone)}T00:00:00Z`) },
  });
};
