import type { PrismaClient } from "@ryadom/db";
import { linkKey, redeemGift } from "@ryadom/gifts";
import { publishUserEvent } from "@ryadom/presence";
import type { Redis } from "ioredis";

/**
 * Заказы подарков для персонала заведения.
 * В Telegram уходит только позиция, код выдачи и номер столика —
 * без имён, фото и описания внешности получателя и отправителя (CLAUDE.md, «Подарок»).
 */

export type InlineButton = { text: string; callback_data: string };
export type StaffApi = {
  sendMessage(chatId: string, text: string, buttons?: InlineButton[]): Promise<void>;
};

const REDEEM_PREFIX = "redeem:";

export const orderText = (o: {
  item: string;
  pickupCode: string | null;
  delivery: "pickup" | "table" | null;
  tableNumber: string | null;
}) =>
  [
    "🎁 Подарок для гостя",
    `Позиция: ${o.item}`,
    `Код выдачи: ${o.pickupCode ?? "—"}`,
    o.delivery === "table"
      ? `Принести за столик ${o.tableNumber}`
      : "Гость заберёт у стойки по коду",
    "Оплачено через «рядом».",
  ].join("\n");

export const createOrders = ({
  db,
  redis,
  api,
}: {
  db: PrismaClient;
  redis: Redis;
  api: StaffApi;
}) => {
  /** Отправить заказ персоналу один раз. Если Telegram недоступен — повторим позже. */
  const announce = async (giftId: string) => {
    const gift = await db.gift.findUnique({
      where: { id: giftId },
      include: {
        menuItem: { select: { name: true } },
        venue: { select: { telegramChatId: true } },
      },
    });
    if (!gift || gift.status !== "accepted" || gift.staffNotifiedAt) return false;
    const chatId = gift.venue.telegramChatId;
    if (!chatId) {
      console.warn(`bot: у заведения ${gift.venueId} не привязан чат персонала (pnpm bot:link)`);
      return false;
    }
    // Сначала «забираем» заказ, чтобы два процесса не отправили его дважды.
    const claimed = await db.gift.updateMany({
      where: { id: gift.id, staffNotifiedAt: null },
      data: { staffNotifiedAt: new Date() },
    });
    if (claimed.count !== 1) return false;
    try {
      await api.sendMessage(
        chatId,
        orderText({
          item: gift.menuItem.name,
          pickupCode: gift.pickupCode,
          delivery: gift.delivery,
          tableNumber: gift.tableNumber,
        }),
        [{ text: "Выдано", callback_data: `${REDEEM_PREFIX}${gift.id}` }],
      );
      return true;
    } catch (err) {
      await db.gift.update({ where: { id: gift.id }, data: { staffNotifiedAt: null } });
      console.error("bot: не удалось отправить заказ", err instanceof Error ? err.message : "");
      return false;
    }
  };

  /** Досылаем принятые подарки, которые не ушли персоналу (бот был выключен). */
  const announcePending = async () => {
    const gifts = await db.gift.findMany({
      where: {
        status: "accepted",
        staffNotifiedAt: null,
        venue: { telegramChatId: { not: null } },
      },
      select: { id: true },
      take: 50,
    });
    let sent = 0;
    for (const g of gifts) if (await announce(g.id)) sent++;
    return sent;
  };

  /** Кнопка «Выдано». Работает только в чате того заведения, где подарок. */
  const onButton = async (data: string, chatId: string) => {
    if (!data.startsWith(REDEEM_PREFIX)) return { ok: false as const, text: "Неизвестная кнопка" };
    const res = await redeemGift(db, data.slice(REDEEM_PREFIX.length), chatId);
    if (!res.ok) {
      const text =
        res.error === "not_accepted" ? "Этот подарок уже выдан или отменён." : "Заказ не найден.";
      return { ok: false as const, text };
    }
    for (const u of [res.gift.toUserId, res.gift.fromUserId])
      if (u) await publishUserEvent(redis, { type: "inbox", userId: u });
    return { ok: true as const, text: "Отмечено: выдано ✓" };
  };

  /** /link КОД — привязать этот чат к заведению. */
  const link = async (code: string, chatId: string) => {
    const venueId = await redis.getdel(linkKey(code.trim().toUpperCase()));
    if (!venueId) return null;
    const venue = await db.venue.update({
      where: { id: venueId },
      data: { telegramChatId: chatId },
      select: { name: true },
    });
    await announcePending();
    return venue.name;
  };

  return { announce, announcePending, onButton, link };
};
