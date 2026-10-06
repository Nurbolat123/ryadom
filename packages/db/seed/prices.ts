import { toMinor, type ProductCode } from "@ryadom/shared";

/** Цены для Казахстана (CLAUDE.md, «Тарифы и покупки»). */
export const pricesKZ: { product: ProductCode; amount: number }[] = [
  { product: "plus_evening", amount: toMinor(490) },
  { product: "plus_week", amount: toMinor(990) },
  { product: "plus_month", amount: toMinor(1990) },
  { product: "plus_3months", amount: toMinor(4490) },
  { product: "super_hello_1", amount: toMinor(290) },
  { product: "super_hello_5", amount: toMinor(990) },
];
