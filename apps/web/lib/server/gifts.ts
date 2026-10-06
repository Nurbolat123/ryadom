import { randomUUID } from "node:crypto";
import { prisma } from "@ryadom/db";
import {
  closePendingGift,
  commissionFor,
  getPaymentProvider,
  newPickupCode,
  publishGiftEvent,
} from "@ryadom/gifts";
import { getPresence, publishUserEvent } from "@ryadom/presence";
import { GiftAcceptSchema, GiftInputSchema, RULES } from "@ryadom/shared";
import type { z } from "zod";
import { rateLimit } from "../rate-limit";
import { redis } from "../redis";
import { track } from "./analytics";
import { canSeePerson } from "./people";

/**
 * Подарок-комплимент (правило 8).
 * - Только у партнёров, только giftable и без алкоголя, не дороже maxGiftAmount.
 * - Не больше 1 подарка одному человеку за визит и 3 подарков в сутки от отправителя.
 * - Отказ невидим (правило 7): отправитель видит только «подарок не был получен» —
 *   так же, как при истечении 2 часов. Деньги возвращаются автоматически.
 * - Персоналу (Telegram-бот) уходит позиция, код выдачи и номер столика — без имён.
 */

const deps = () => ({ db: prisma, payments: getPaymentProvider() });

const defaultCommissionPct = () => Number(process.env.PLATFORM_COMMISSION_PCT ?? 12);
const defaultMaxAmount = () => Number(process.env.DEFAULT_MAX_GIFT_AMOUNT ?? 500_000);

const giftableItems = (venueId: string, maxAmount: number) =>
  prisma.menuItem.findMany({
    where: {
      venueId,
      giftable: true,
      isAlcohol: false,
      isAvailable: true,
      price: { lte: maxAmount },
    },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  });

const itemName = (i: { name: string; nameKk: string | null }, locale: "ru" | "kk") =>
  locale === "kk" ? (i.nameKk ?? i.name) : i.name;

export type GiftMenu = {
  venueName: string;
  items: { id: string; name: string; price: number; currency: string }[];
};

/** Меню «Угостить» текущего заведения: только для отмеченных в заведении-партнёре. */
export const giftMenu = async (
  userId: string,
  locale: "ru" | "kk",
): Promise<
  { ok: true; menu: GiftMenu } | { ok: false; error: "not_checked_in" | "not_partner" }
> => {
  const presence = await getPresence(redis, userId);
  if (!presence) return { ok: false, error: "not_checked_in" };
  const venue = await prisma.venue.findUnique({ where: { id: presence.venueId } });
  if (!venue?.isPartner) return { ok: false, error: "not_partner" };
  const items = await giftableItems(venue.id, venue.maxGiftAmount ?? defaultMaxAmount());
  return {
    ok: true,
    menu: {
      venueName: venue.name,
      items: items.map((i) => ({
        id: i.id,
        name: itemName(i, locale),
        price: i.price,
        currency: i.currency,
      })),
    },
  };
};

export type SendGiftError =
  | "not_found"
  | "not_partner"
  | "item_unavailable"
  | "gift_already_sent"
  | "gift_daily_limit"
  | "rate_limited"
  | "payment_failed";

export const sendGift = async (
  fromId: string,
  toId: string,
  input: z.infer<typeof GiftInputSchema>,
): Promise<{ ok: true; giftId: string } | { ok: false; error: SendGiftError }> => {
  if (fromId === toId) return { ok: false, error: "not_found" };
  const presence = await canSeePerson(fromId, toId);
  if (!presence) return { ok: false, error: "not_found" };
  const venue = await prisma.venue.findUnique({ where: { id: presence.venueId } });
  if (!venue?.isPartner) return { ok: false, error: "not_partner" };

  // Только позиции из «Угостить»: giftable, без алкоголя, в наличии, не дороже лимита.
  const item = (await giftableItems(venue.id, venue.maxGiftAmount ?? defaultMaxAmount())).find(
    (i) => i.id === input.menuItemId,
  );
  if (!item) return { ok: false, error: "item_unavailable" };

  if (!(await rateLimit("gift", fromId, RULES.giftAttemptsPerHour, 3600)).ok)
    return { ok: false, error: "rate_limited" };

  // Два одновременных запроса не должны обойти лимиты.
  const lock = `gift-lock:${fromId}`;
  if ((await redis.set(lock, "1", "PX", 15_000, "NX")) !== "OK")
    return { ok: false, error: "rate_limited" };
  try {
    const [toThisPerson, today] = await Promise.all([
      prisma.gift.count({
        where: { fromUserId: fromId, toUserId: toId, visitId: presence.visitId },
      }),
      prisma.gift.count({
        where: { fromUserId: fromId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      }),
    ]);
    if (toThisPerson >= RULES.giftsPerRecipientPerVisit)
      return { ok: false, error: "gift_already_sent" };
    if (today >= RULES.giftsPerSenderPerDay) return { ok: false, error: "gift_daily_limit" };

    const payments = getPaymentProvider();
    const paid = await payments.charge({
      amount: item.price,
      currency: item.currency,
      description: `Подарок в «${venue.name}»`,
      idempotencyKey: randomUUID(),
    });
    if (!paid.ok) return { ok: false, error: "payment_failed" };

    const pct = venue.commissionPct === null ? defaultCommissionPct() : Number(venue.commissionPct);
    let giftId: string;
    const now = new Date();
    try {
      const gift = await prisma.gift.create({
        data: {
          fromUserId: fromId,
          toUserId: toId,
          venueId: venue.id,
          visitId: presence.visitId,
          menuItemId: item.id,
          amount: item.price,
          commission: commissionFor(item.price, pct),
          currency: item.currency,
          note: input.note || null,
          paymentId: paid.paymentId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + RULES.giftTtlSeconds * 1000),
        },
      });
      giftId = gift.id;
    } catch (err) {
      // Деньги списаны, а подарок не создался — сразу возвращаем.
      await payments.refund(paid.paymentId, item.price).catch(() => undefined);
      throw err;
    }
    await publishUserEvent(redis, { type: "inbox", userId: toId });
    await track("gift_sent", venue.id);
    return { ok: true, giftId };
  } finally {
    await redis.del(lock);
  }
};

export type AcceptInput = z.infer<typeof GiftAcceptSchema>;

/** Принять: получатель должен быть в этом заведении. Персоналу уходит заказ без имён. */
export const acceptGift = async (userId: string, giftId: string, input: AcceptInput) => {
  const gift = await prisma.gift.findFirst({
    where: { id: giftId, toUserId: userId, status: "pending", expiresAt: { gt: new Date() } },
  });
  if (!gift) return { ok: false as const, error: "not_found" as const };
  const presence = await getPresence(redis, userId);
  if (presence?.venueId !== gift.venueId) return { ok: false as const, error: "not_here" as const };

  const res = await prisma.gift.updateMany({
    where: { id: gift.id, status: "pending" },
    data: {
      status: "accepted",
      acceptedAt: new Date(),
      delivery: input.delivery,
      pickupCode: newPickupCode(),
      tableNumber: input.delivery === "table" ? input.tableNumber : null,
    },
  });
  if (res.count !== 1) return { ok: false as const, error: "not_found" as const };
  await publishGiftEvent(redis, { type: "accepted", giftId: gift.id });
  if (gift.fromUserId) await publishUserEvent(redis, { type: "inbox", userId: gift.fromUserId });
  await track("gift_accepted", gift.venueId);
  return { ok: true as const };
};

/** «Не принимать»: отправитель об этом не узнаёт (правило 7), деньги возвращаются. */
export const declineGift = async (userId: string, giftId: string) => {
  const gift = await prisma.gift.findFirst({
    where: { id: giftId, toUserId: userId, status: "pending" },
    select: { id: true },
  });
  if (!gift) return false;
  await closePendingGift(deps(), gift.id, "declined");
  return true;
};

export type ReceivedGift = {
  id: string;
  status: "pending" | "accepted" | "redeemed";
  item: string;
  note: string | null;
  venueName: string;
  from: { id: string; name: string; photoUrl: string };
  delivery: "pickup" | "table" | null;
  pickupCode: string | null;
  tableNumber: string | null;
  expiresAt: string;
};
/** Для отправителя статус нейтральный: отказ и истечение выглядят одинаково (правило 7). */
export type SentGift = {
  id: string;
  item: string;
  amount: number;
  currency: string;
  toName: string;
  status: "waiting" | "accepted" | "not_received";
  refunded: boolean;
};

export const listGifts = async (userId: string, locale: "ru" | "kk") => {
  const since = new Date(Date.now() - 24 * 3600_000);
  const now = new Date();
  const [blocks, received, sent] = await Promise.all([
    prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.gift.findMany({
      where: {
        toUserId: userId,
        from: { bannedAt: null },
        OR: [
          { status: "pending", expiresAt: { gt: now } },
          { status: "accepted" },
          { status: "redeemed", redeemedAt: { gte: since } },
        ],
      },
      orderBy: { createdAt: "desc" },
      include: {
        menuItem: { select: { name: true, nameKk: true } },
        venue: { select: { name: true } },
        from: { select: { id: true, displayName: true } },
      },
    }),
    prisma.gift.findMany({
      where: { fromUserId: userId, createdAt: { gte: since }, to: { bannedAt: null } },
      orderBy: { createdAt: "desc" },
      include: {
        menuItem: { select: { name: true, nameKk: true } },
        to: { select: { id: true, displayName: true } },
      },
    }),
  ]);
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  return {
    received: received
      .filter((g) => g.from && !blocked.has(g.from.id))
      .map((g): ReceivedGift => ({
        id: g.id,
        status: g.status as ReceivedGift["status"],
        item: itemName(g.menuItem, locale),
        note: g.note,
        venueName: g.venue.name,
        from: {
          id: g.from!.id,
          name: g.from!.displayName,
          photoUrl: `/api/people/${g.from!.id}/photo`,
        },
        delivery: g.delivery,
        pickupCode: g.status === "pending" ? null : g.pickupCode,
        tableNumber: g.tableNumber,
        expiresAt: g.expiresAt.toISOString(),
      })),
    sent: sent
      .filter((g) => g.to && !blocked.has(g.to.id))
      .map((g): SentGift => ({
        id: g.id,
        item: itemName(g.menuItem, locale),
        amount: g.amount,
        currency: g.currency,
        toName: g.to!.displayName,
        status:
          g.status === "pending"
            ? "waiting"
            : g.status === "accepted" || g.status === "redeemed"
              ? "accepted"
              : "not_received",
        refunded: !!g.refundedAt,
      })),
  };
};

/** Ожидающие ответа подарки — для значка на «Приветы». */
export const pendingGiftsCount = (userId: string) =>
  prisma.gift.count({
    where: {
      toUserId: userId,
      status: "pending",
      expiresAt: { gt: new Date() },
      from: { bannedAt: null },
    },
  });
