import { prisma, type AnalyticsEventType } from "@ryadom/db";
import { todayIn } from "@ryadom/shared";

/** Обезличенное событие воронки: тип, заведение, местный день. Без пользователя и текстов. */
export const track = async (type: AnalyticsEventType, venueId: string | null) => {
  const venue = venueId
    ? await prisma.venue.findUnique({ where: { id: venueId }, select: { timezone: true } })
    : null;
  await prisma.analyticsEvent.create({
    data: { type, venueId, day: new Date(`${todayIn(venue?.timezone)}T00:00:00Z`) },
  });
};
