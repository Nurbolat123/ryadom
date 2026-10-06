import { prisma, trackEvent, type AnalyticsEventType } from "@ryadom/db";

/** Обезличенное событие воронки: тип, заведение, местный день. Без пользователя и текстов. */
export const track = (type: AnalyticsEventType, venueId: string | null) =>
  trackEvent(prisma, type, venueId);
