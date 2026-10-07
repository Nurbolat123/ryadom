import type { PrismaClient } from "@ryadom/db";
import { partnerReport, redeemOfferCode } from "@ryadom/places";
import { TEXTS, textsFor } from "./texts";

/**
 * Предложения заведения в чате персонала (этап 11).
 * - /redeem КОД — погасить код скидки, который гость показал у стойки.
 * - /report — показы, переходы и погашения предложений за 7 дней.
 * Работает только в чате, привязанном к заведению; код другого заведения не находится.
 * В ответах нет имён и данных гостей: код к человеку не привязан.
 */
export const createOfferCommands = (db: PrismaClient) => {
  const venueOf = (chatId: string) =>
    db.venue.findFirst({
      where: { telegramChatId: chatId },
      select: { id: true, name: true, staffLocale: true },
    });
  // Чат не привязан — язык неизвестен, отвечаем на обоих.
  const notLinked = `${TEXTS.ru.notLinked}\n${TEXTS.kk.notLinked}`;

  const redeem = async (chatId: string, code: string) => {
    const venue = await venueOf(chatId);
    if (!venue) return notLinked;
    const t = textsFor(venue.staffLocale);
    if (!/^[A-Za-z0-9]{4,12}$/.test(code.trim())) return t.redeemUsage;
    const res = await redeemOfferCode(db, venue.id, code);
    if (res.ok) return t.redeemed(res.title);
    return t.redeemError[res.error];
  };

  const report = async (chatId: string, days = 7) => {
    const venue = await venueOf(chatId);
    if (!venue) return notLinked;
    const r = await partnerReport(db, venue.id, days);
    return textsFor(venue.staffLocale).report({ venue: venue.name, days, ...r });
  };

  return { redeem, report };
};
