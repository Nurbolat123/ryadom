import { z } from "zod";
import { RULES } from "./rules";

/**
 * Presence хранится только в Redis (не в Postgres) и истекает сам по TTL.
 * Координат здесь нет и быть не должно (правило 4).
 */
export const PresenceSchema = z.object({
  userId: z.string(),
  venueId: z.string(),
  /** Запись Visit в Postgres (для аналитики и лимитов, другим не показывается). */
  visitId: z.string(),
  /** Правило 2: по умолчанию выключено, включается вручную при каждом визите. */
  openToMeet: z.boolean().default(false),
  startedAt: z.number().int(),
  expiresAt: z.number().int(),
});
export type Presence = z.infer<typeof PresenceSchema>;

export const presenceKeys = {
  /** Hash с данными присутствия пользователя. TTL = RULES.presenceTtlSeconds. */
  user: (userId: string) => `presence:user:${userId}`,
  /** Sorted set userId всех, кто сейчас в заведении; score = expiresAt (мс). */
  venue: (venueId: string) => `presence:venue:${venueId}`,
  /** Sorted set userId тех, кто в заведении открыт к знакомству; score = expiresAt (мс). */
  venueOpen: (venueId: string) => `presence:venue:${venueId}:open`,
} as const;

export const newPresence = (
  userId: string,
  venueId: string,
  visitId: string,
  now = Date.now(),
): Presence => ({
  userId,
  venueId,
  visitId,
  openToMeet: false,
  startedAt: now,
  expiresAt: now + RULES.presenceTtlSeconds * 1000,
});

/** Одноразовый билет для входа в realtime-сервис (ключ — хэш билета, значение — userId). */
export const realtimeTicketKey = (ticketHash: string) => `rt-ticket:${ticketHash}`;
export const REALTIME_TICKET_TTL_SEC = 60;
