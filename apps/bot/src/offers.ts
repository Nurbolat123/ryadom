import type { PrismaClient } from "@ryadom/db";
import { partnerReport, redeemOfferCode } from "@ryadom/places";

/**
 * Предложения заведения в чате персонала (этап 11).
 * - /redeem КОД — погасить код скидки, который гость показал у стойки.
 * - /report — показы, переходы и погашения предложений за 7 дней.
 * Работает только в чате, привязанном к заведению; код другого заведения не находится.
 * В ответах нет имён и данных гостей: код к человеку не привязан.
 */
export const createOfferCommands = (db: PrismaClient) => {
  const venueOf = (chatId: string) =>
    db.venue.findFirst({ where: { telegramChatId: chatId }, select: { id: true, name: true } });
  const notLinked = "Этот чат не привязан к заведению. Отправьте /link КОД.";

  const redeem = async (chatId: string, code: string) => {
    const venue = await venueOf(chatId);
    if (!venue) return notLinked;
    if (!/^[A-Za-z0-9]{4,12}$/.test(code.trim())) return "Отправьте: /redeem КОД";
    const res = await redeemOfferCode(db, venue.id, code);
    if (res.ok) return `✓ Код погашен: «${res.title}».`;
    return {
      not_found: "Такого кода нет у этого заведения.",
      used: "Этот код уже погашен.",
      expired: "Срок действия кода истёк.",
    }[res.error];
  };

  const report = async (chatId: string, days = 7) => {
    const venue = await venueOf(chatId);
    if (!venue) return notLinked;
    const r = await partnerReport(db, venue.id, days);
    return [
      `«${venue.name}»: предложения за ${days} дней`,
      `Показы: ${r.impressions}`,
      `Переходы: ${r.clicks}`,
      `Выдано кодов: ${r.codesIssued}`,
      `Погашено: ${r.redemptions}`,
    ].join("\n");
  };

  return { redeem, report };
};
