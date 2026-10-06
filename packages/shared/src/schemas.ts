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
