import { randomInt } from "node:crypto";
import { trackEvent, type Gift, type PrismaClient } from "@ryadom/db";
import type { Redis } from "ioredis";
import type { PaymentProvider } from "./payments";

/**
 * Жизненный цикл подарка (CLAUDE.md, «Подарок-комплимент»):
 *   pending → accepted → redeemed
 *   pending → declined | expired → автоматический возврат денег отправителю.
 * Переходы — условным UPDATE по текущему статусу, поэтому гонки (принять и истечь
 * одновременно) не приводят к двойному возврату или выдаче после возврата.
 */

export type GiftDeps = { db: PrismaClient; payments: PaymentProvider };
type Pair = { fromUserId: string | null; toUserId: string | null };

/** Канал заказов для Telegram-бота заведения: только id подарка. */
export const GIFT_CHANNEL = "ryadom:gifts";
export type GiftEvent = { type: "accepted"; giftId: string };
export const publishGiftEvent = (redis: Redis, e: GiftEvent) =>
  redis.publish(GIFT_CHANNEL, JSON.stringify(e));
export const parseGiftEvent = (raw: string): GiftEvent | null => {
  try {
    const e = JSON.parse(raw) as GiftEvent;
    return e?.type === "accepted" && typeof e.giftId === "string" ? e : null;
  } catch {
    return null;
  }
};

/** Код выдачи у стойки: 4 цифры. */
export const newPickupCode = () => String(randomInt(0, 10_000)).padStart(4, "0");

/** Комиссия платформы в тиынах. */
export const commissionFor = (amount: number, pct: number) => Math.round((amount * pct) / 100);

/** Вернуть деньги за закрытый подарок. Ошибку провайдера не пробрасываем — повторит retryRefunds. */
export const refundGift = async ({ db, payments }: GiftDeps, giftId: string) => {
  const g = await db.gift.findUnique({ where: { id: giftId } });
  if (!g || g.refundedAt || !g.paymentId) return false;
  if (g.status !== "declined" && g.status !== "expired") return false;
  try {
    const { refundId } = await payments.refund(g.paymentId, g.amount);
    await db.gift.update({ where: { id: g.id }, data: { refundId, refundedAt: new Date() } });
    return true;
  } catch (err) {
    console.error(
      `[gifts] возврат по подарку ${g.id} не прошёл, повторим позже:`,
      err instanceof Error ? err.message : "",
    );
    return false;
  }
};

/** Закрыть ожидающий подарок (отказ, блокировка, истечение) и вернуть деньги. */
export const closePendingGift = async (
  deps: GiftDeps,
  giftId: string,
  status: "declined" | "expired",
  now = new Date(),
) => {
  const res = await deps.db.gift.updateMany({
    where: { id: giftId, status: "pending" },
    data: status === "declined" ? { status, declinedAt: now } : { status },
  });
  if (res.count !== 1) return false;
  await refundGift(deps, giftId);
  return true;
};

const closeMany = async (
  deps: GiftDeps,
  gifts: (Pair & { id: string })[],
  status: "declined" | "expired",
) => {
  const closed: Pair[] = [];
  for (const g of gifts) if (await closePendingGift(deps, g.id, status)) closed.push(g);
  return closed;
};

const pendingSelect = { id: true, fromUserId: true, toUserId: true } as const;

/** Прошло 2 часа без ответа — expired и возврат. Возвращает пары для уведомлений. */
export const expireGifts = async (deps: GiftDeps, now = new Date()) =>
  closeMany(
    deps,
    await deps.db.gift.findMany({
      where: { status: "pending", expiresAt: { lte: now } },
      select: pendingSelect,
      take: 200,
    }),
    "expired",
  );

/** Блокировка отменяет ожидающие подарки в обе стороны (правило 9). */
export const cancelGiftsBetween = async (deps: GiftDeps, a: string, b: string) =>
  closeMany(
    deps,
    await deps.db.gift.findMany({
      where: {
        status: "pending",
        OR: [
          { fromUserId: a, toUserId: b },
          { fromUserId: b, toUserId: a },
        ],
      },
      select: pendingSelect,
    }),
    "declined",
  );

/** Аккаунт закрыт модератором — все его ожидающие подарки отменяются с возвратом. */
export const cancelGiftsOf = async (deps: GiftDeps, userId: string) =>
  closeMany(
    deps,
    await deps.db.gift.findMany({
      where: { status: "pending", OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: pendingSelect,
    }),
    "declined",
  );

/** Повторить возвраты, которые не прошли (провайдер был недоступен). */
export const retryRefunds = async (deps: GiftDeps, now = new Date()) => {
  const before = new Date(now.getTime() - 60_000);
  const stuck = await deps.db.gift.findMany({
    where: {
      refundedAt: null,
      paymentId: { not: null },
      OR: [
        { status: "declined", declinedAt: { lt: before } },
        { status: "expired", expiresAt: { lt: before } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  let done = 0;
  for (const g of stuck) if (await refundGift(deps, g.id)) done++;
  return done;
};

export type RedeemResult =
  { ok: true; gift: Gift } | { ok: false; error: "not_found" | "wrong_venue" | "not_accepted" };

/**
 * «Выдано» в Telegram-боте: только из чата этого заведения и только для принятого подарка.
 */
export const redeemGift = async (
  db: PrismaClient,
  giftId: string,
  chatId: string,
): Promise<RedeemResult> => {
  const gift = await db.gift.findUnique({
    where: { id: giftId },
    include: { venue: { select: { telegramChatId: true } } },
  });
  if (!gift) return { ok: false, error: "not_found" };
  if (!gift.venue.telegramChatId || gift.venue.telegramChatId !== chatId)
    return { ok: false, error: "wrong_venue" };
  const res = await db.gift.updateMany({
    where: { id: giftId, status: "accepted" },
    data: { status: "redeemed", redeemedAt: new Date() },
  });
  if (res.count !== 1) return { ok: false, error: "not_accepted" };
  await trackEvent(db, "gift_redeemed", gift.venueId);
  const updated = await db.gift.findUniqueOrThrow({ where: { id: giftId } });
  return { ok: true, gift: updated };
};
