/**
 * Значения enum-ов, общие для БД (Prisma) и клиента.
 * Должны совпадать с enum-ами в packages/db/prisma/schema.prisma.
 */
export const Gender = ["male", "female", "other"] as const;
export type Gender = (typeof Gender)[number];

export const Locale = ["ru", "kk"] as const;
export type Locale = (typeof Locale)[number];

export const VenueCategory = [
  "cafe",
  "coffee",
  "bar",
  "restaurant",
  "coworking",
  "event",
  "other",
] as const;
export type VenueCategory = (typeof VenueCategory)[number];

export const VenueSourceKind = ["seed", "osm", "dgis", "user", "admin"] as const;
export type VenueSourceKind = (typeof VenueSourceKind)[number];

export const HelloStatus = ["pending", "replied", "dismissed"] as const;
export type HelloStatus = (typeof HelloStatus)[number];

export const GiftStatus = ["pending", "accepted", "redeemed", "declined", "expired"] as const;
export type GiftStatus = (typeof GiftStatus)[number];

export const OfferType = ["discount", "event", "promo"] as const;
export type OfferType = (typeof OfferType)[number];

export const OfferPlacement = ["badge", "promo_card", "event_of_day"] as const;
export type OfferPlacement = (typeof OfferPlacement)[number];

export const ModerationStatus = ["pending", "approved", "rejected"] as const;
export type ModerationStatus = (typeof ModerationStatus)[number];

export const ProductCode = [
  "plus_evening",
  "plus_week",
  "plus_month",
  "plus_3months",
  "super_hello_1",
  "super_hello_5",
] as const;
export type ProductCode = (typeof ProductCode)[number];

export const PaymentStatus = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PaymentStatus)[number];

export const GiftDelivery = ["pickup", "table"] as const;
export type GiftDelivery = (typeof GiftDelivery)[number];

export const ReportReason = [
  "fake_profile",
  "harassment",
  "underage",
  "spam",
  "inappropriate",
  "other",
] as const;
export type ReportReason = (typeof ReportReason)[number];

/** Шаги воронки для теста идеи (раздел «Аналитика»). Без персональных данных. */
export const AnalyticsEventType = [
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
export type AnalyticsEventType = (typeof AnalyticsEventType)[number];
