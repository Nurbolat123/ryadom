import { cancelAutoRenew, getPaymentProvider, priceFor, productDescription } from "@ryadom/billing";
import { prisma } from "@ryadom/db";
import { getPresence, publishPresenceEvent } from "@ryadom/presence";
import {
  isRenewable,
  PLUS_PRODUCTS,
  PurchaseInputSchema,
  RULES,
  SUPER_HELLO_PRODUCTS,
} from "@ryadom/shared";
import type { z } from "zod";
import { rateLimit } from "../rate-limit";
import { redis } from "../redis";
import { startCheckout } from "./payments";
import { superHellosLeft } from "./social";

/**
 * «Плюс» и суперприветы. Правило 11: платное не обходит согласие — «Плюс» не даёт
 * второй привет тому же человеку, не раскрывает симпатии и не показывает людей вне заведения.
 * Буст поднимает выше в списке только среди тех, кто и так тебя видит.
 */

export const boostKey = (userId: string) => `boost:${userId}`;
const boostUsedKey = (visitId: string) => `boost-used:${visitId}`;

const canAutoRenew = () => getPaymentProvider().supportsRecurring;

export const plusState = async (userId: string) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { countryCode: true },
  });
  const [e, supers, prices, presence, boostVenue] = await Promise.all([
    prisma.entitlement.findUnique({ where: { userId } }),
    superHellosLeft(userId),
    prisma.price.findMany({ where: { countryCode: user.countryCode, isActive: true } }),
    getPresence(redis, userId),
    redis.get(boostKey(userId)),
  ]);
  const active = !!e?.plusUntil && e.plusUntil > new Date();
  const boostTtl = boostVenue ? await redis.pttl(boostKey(userId)) : -1;
  const boostUsed = presence ? !!(await redis.exists(boostUsedKey(presence.visitId))) : false;
  return {
    plus: {
      active,
      until: active ? e!.plusUntil!.toISOString() : null,
      autoRenew: active && !!e?.autoRenew,
      autoRenewProduct: e?.autoRenewProduct ?? null,
    },
    superHellos: supers,
    canAutoRenew: canAutoRenew(),
    boost: {
      until: boostVenue && boostTtl > 0 ? new Date(Date.now() + boostTtl).toISOString() : null,
      available: active && !!presence?.openToMeet && !boostUsed && !boostVenue,
    },
    products: [...PLUS_PRODUCTS, ...SUPER_HELLO_PRODUCTS]
      .map((code) => prices.find((p) => p.product === code))
      .filter((p) => !!p)
      .map((p) => ({ product: p.product, amount: p.amount, currency: p.currency })),
  };
};

export type BuyError =
  "invalid_product" | "auto_renew_unavailable" | "rate_limited" | "payment_failed";

export const buyProduct = async (userId: string, input: z.infer<typeof PurchaseInputSchema>) => {
  if (input.autoRenew && (!isRenewable(input.product) || !canAutoRenew()))
    return { ok: false as const, error: "auto_renew_unavailable" as const };
  if (!(await rateLimit("purchase", userId, 20, 3600)).ok)
    return { ok: false as const, error: "rate_limited" as const };
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { countryCode: true },
  });
  const price = await priceFor(prisma, user.countryCode, input.product);
  if (!price?.isActive) return { ok: false as const, error: "invalid_product" as const };
  const res = await startCheckout({
    userId,
    product: input.product,
    autoRenew: input.autoRenew,
    amount: price.amount,
    currency: price.currency,
    description: productDescription[input.product],
  });
  if (res.status === "failed") return { ok: false as const, error: "payment_failed" as const };
  return { ok: true as const, ...res };
};

export const stopAutoRenew = (userId: string) => cancelAutoRenew(prisma, userId);

/** Буст на час: только с «Плюс», только открытым к знакомству, один раз за визит. */
export const startBoost = async (userId: string) => {
  const presence = await getPresence(redis, userId);
  if (!presence?.openToMeet) return { ok: false as const, error: "not_checked_in" as const };
  const e = await prisma.entitlement.findUnique({ where: { userId }, select: { plusUntil: true } });
  if (!e?.plusUntil || e.plusUntil <= new Date())
    return { ok: false as const, error: "no_plus" as const };
  const fresh = await redis.set(
    boostUsedKey(presence.visitId),
    "1",
    "EX",
    RULES.presenceTtlSeconds,
    "NX",
  );
  if (fresh !== "OK") return { ok: false as const, error: "boost_used" as const };
  await redis.set(boostKey(userId), presence.venueId, "EX", RULES.boostSeconds);
  // Обновить списки в заведении: сигнал без данных, как при включении «Открыт(а)».
  await publishPresenceEvent(redis, { type: "open", venueId: presence.venueId, userId });
  return {
    ok: true as const,
    until: new Date(Date.now() + RULES.boostSeconds * 1000).toISOString(),
  };
};
