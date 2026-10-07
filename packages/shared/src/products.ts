import type { ProductCode } from "./enums";

/** «Плюс» и суперприветы (CLAUDE.md, «Тарифы и покупки»). Цены — в таблице Price по странам. */
export const PLUS_PRODUCTS = ["plus_evening", "plus_week", "plus_month", "plus_3months"] as const;
export const SUPER_HELLO_PRODUCTS = ["super_hello_1", "super_hello_5"] as const;

/** Длительность «Плюс», часы. */
export const PLUS_HOURS: Record<(typeof PLUS_PRODUCTS)[number], number> = {
  plus_evening: 24,
  plus_week: 7 * 24,
  plus_month: 30 * 24,
  plus_3months: 90 * 24,
};
/** Сколько суперприветов в пакете. */
export const SUPER_HELLO_COUNT: Record<(typeof SUPER_HELLO_PRODUCTS)[number], number> = {
  super_hello_1: 1,
  super_hello_5: 5,
};
/** Автопродление можно включить только у месячных тарифов, и только с явного согласия. */
export const RENEWABLE_PRODUCTS = ["plus_month", "plus_3months"] as const;

export const isPlusProduct = (p: ProductCode): p is (typeof PLUS_PRODUCTS)[number] =>
  (PLUS_PRODUCTS as readonly string[]).includes(p);
export const isRenewable = (p: ProductCode) =>
  (RENEWABLE_PRODUCTS as readonly string[]).includes(p);
