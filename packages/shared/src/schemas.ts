import { z } from "zod";
import { Gender, Locale, VenueCategory } from "./enums";
import { TEXT_LIMITS } from "./rules";

export const LocaleSchema = z.enum(Locale);
export const GenderSchema = z.enum(Gender);
export const VenueCategorySchema = z.enum(VenueCategory);

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const AboutSchema = z.string().trim().max(TEXT_LIMITS.about);
export const HelloMessageSchema = z.string().trim().min(1).max(TEXT_LIMITS.hello);
export const SuperHelloMessageSchema = z.string().trim().min(1).max(TEXT_LIMITS.superHello);
export const HelloInputSchema = z.discriminatedUnion("isSuper", [
  z.object({ isSuper: z.literal(false), message: HelloMessageSchema }),
  z.object({ isSuper: z.literal(true), message: SuperHelloMessageSchema }),
]);
export const ChatMessageSchema = z.string().trim().min(1).max(TEXT_LIMITS.message);

/** Публичное представление заведения. Без координат и геозоны (правило 4 — точки не уходят клиенту). */
export const PublicVenueSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: VenueCategorySchema,
  address: z.string().nullable(),
  city: z.string(),
  isPartner: z.boolean(),
});
export type PublicVenue = z.infer<typeof PublicVenueSchema>;

/** Дата рождения YYYY-MM-DD, реальная дата, возраст не больше 100 лет. */
export const BirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().startsWith(s) &&
      Number(s.slice(0, 4)) >= new Date().getUTCFullYear() - 100
    );
  });

/** Имя на карточке: буквы любых алфавитов, пробел, дефис, апостроф. */
export const DisplayNameSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[\p{L}][\p{L}\p{M}' -]*$/u);

export const OtpCodeSchema = z.string().regex(/^\d{6}$/);

/** На карточке выбираем из двух вариантов; в схеме БД есть и other. */
export const SignupGenderSchema = z.enum(["male", "female"]);

export const ProfileInputSchema = z
  .object({
    birthDate: BirthDateSchema,
    gender: SignupGenderSchema,
    displayName: DisplayNameSchema,
  })
  .strict();

/** Правка своего профиля: имя, «о себе», согласие на предложения по интересам (правило 14). */
export const ProfileUpdateSchema = z
  .object({
    displayName: DisplayNameSchema.optional(),
    about: z.string().trim().max(TEXT_LIMITS.about).optional(),
    adsConsent: z.boolean().optional(),
  })
  .strict();

export const REPORT_REASONS = [
  "fake_profile",
  "harassment",
  "underage",
  "spam",
  "inappropriate",
  "other",
] as const;
export const ReportInputSchema = z.object({
  reason: z.enum(REPORT_REASONS),
  comment: z.string().trim().max(TEXT_LIMITS.reportComment).optional(),
  /** Пожаловаться и сразу заблокировать (по умолчанию — да). */
  block: z.boolean().default(true),
});
export const MODERATION_ACTIONS = ["dismissed", "photo_removed", "banned"] as const;

/** «Угостить»: позиция меню и короткое сообщение. */
export const GiftInputSchema = z.object({
  menuItemId: z.string().min(1).max(40),
  note: z.string().trim().max(TEXT_LIMITS.giftNote).optional(),
});
/** Принять подарок: «Заберу у стойки» или «Пусть принесут» за столик (номер вводит сам получатель). */
export const GiftAcceptSchema = z.discriminatedUnion("delivery", [
  z.object({ delivery: z.literal("pickup") }),
  z.object({
    delivery: z.literal("table"),
    tableNumber: z
      .string()
      .trim()
      .regex(/^[\p{L}\p{N} -]{1,10}$/u),
  }),
]);

/** Покупка «Плюс» или суперприветов. Автопродление — только явной галочкой (по умолчанию нет). */
export const PurchaseInputSchema = z.object({
  product: z.enum([
    "plus_evening",
    "plus_week",
    "plus_month",
    "plus_3months",
    "super_hello_1",
    "super_hello_5",
  ]),
  autoRenew: z.boolean().default(false),
});

/** «Где знакомятся сейчас». Точка человека — только для сортировки «Рядом», не сохраняется. */
export const PlacesQuerySchema = z.object({
  city: z.enum(["almaty", "astana"]),
  category: z.enum(VenueCategory).optional(),
  sort: z.enum(["activity", "near"]).default("activity"),
  near: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional(),
  offset: z.number().int().min(0).max(10_000).default(0),
});

/** Предложение заведения (админка). Создаётся на модерации. */
export const OfferInputSchema = z
  .object({
    venueSlug: z.string().min(1).max(120),
    type: z.enum(["discount", "event", "promo"]),
    placement: z.enum(["badge", "promo_card", "event_of_day"]),
    title: z.string().trim().min(3).max(80),
    description: z.string().trim().max(500).optional(),
    titleKk: z.string().trim().max(80).optional(),
    descriptionKk: z.string().trim().max(500).optional(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    isPaid: z.boolean().default(false),
  })
  .refine((o) => o.endsAt > o.startsAt, { message: "period", path: ["endsAt"] })
  .refine((o) => o.placement !== "event_of_day" || o.type === "event", {
    message: "event_of_day",
    path: ["placement"],
  });

// ───────────────────────── Админка заведений ─────────────────────────

/** Радиус ручной геозоны-круга, м: меньше — не попасть с погрешностью GPS, больше — соседние места. */
export const GEOFENCE_RADIUS_M = { min: 15, max: 150 } as const;

/** Правка заведения. Суммы — в тенге (целые), в базе хранятся в тиынах. */
export const VenueUpdateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    category: VenueCategorySchema,
    address: z.string().trim().max(200).nullable(),
    isActive: z.boolean(),
    isPartner: z.boolean(),
    /** Комиссия платформы, %; null — общая настройка PLATFORM_COMMISSION_PCT. */
    commissionPct: z.number().min(0).max(50).nullable(),
    /** Максимальная стоимость подарка, ₸; null — DEFAULT_MAX_GIFT_AMOUNT. */
    maxGiftAmount: z.number().int().min(100).max(100_000).nullable(),
  })
  .partial()
  .strict();

/** Ручная геозона-круг: точка заведения и радиус. Импорт её больше не перезапишет. */
export const GeofenceInputSchema = LatLngSchema.extend({
  radiusM: z.number().int().min(GEOFENCE_RADIUS_M.min).max(GEOFENCE_RADIUS_M.max),
}).strict();

/**
 * Новое заведение, добавленное модератором (геозона — круг 35 м, потом можно поправить).
 * Город определяется по точке.
 */
export const VenueCreateSchema = LatLngSchema.extend({
  name: z.string().trim().min(2).max(80),
  category: VenueCategorySchema,
  address: z.string().trim().max(200).optional(),
}).strict();

/** Позиция меню. Цена — в тенге. Алкоголь нельзя подарить (правило 8). */
export const MenuItemInputSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    nameKk: z.string().trim().max(80).nullable().optional(),
    price: z.number().int().min(1).max(1_000_000),
    isAlcohol: z.boolean(),
    giftable: z.boolean(),
    isAvailable: z.boolean(),
    sortOrder: z.number().int().min(0).max(999).optional(),
  })
  .strict()
  .refine((m) => !(m.isAlcohol && m.giftable), { message: "alcohol", path: ["giftable"] });
