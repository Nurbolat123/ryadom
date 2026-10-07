import { prisma } from "@ryadom/db";
import { getPaymentProvider } from "@ryadom/billing";
import { cancelGiftsOf } from "@ryadom/gifts";
import { endPresence, publishPresenceEvent, publishUserEvent } from "@ryadom/presence";
import { ProfileUpdateSchema } from "@ryadom/shared";
import type { z } from "zod";
import { redis } from "../redis";
import { boostKey } from "./plus";
import { getPhotoStorage } from "./storage";

/** Правка своего профиля: имя, «о себе», согласие на предложения по интересам. */
export const updateProfile = async (userId: string, input: z.infer<typeof ProfileUpdateSchema>) =>
  prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.about === undefined ? {} : { about: input.about || null }),
      ...(input.adsConsent === undefined ? {} : { adsConsent: input.adsConsent }),
    },
    select: { displayName: true, about: true, adsConsent: true },
  });

/**
 * Удаление аккаунта — полностью и сразу (экран «Профиль»).
 * - Ожидающие подарки в обе стороны закрываются с возвратом денег отправителю.
 * - Отметка в заведении снимается, фото удаляется из хранилища.
 * - Профиль, интересы, симпатии, приветы, чаты, сообщения, обмен контактами, визиты,
 *   сессии и push-подписки удаляются каскадом. В платежах и жалобах остаётся запись
 *   без ссылки на человека (бухгалтерия и модерация), аналитика и так обезличена.
 * - Собеседникам — сигнал обновить входящие и чаты (без данных о человеке).
 */
export const deleteAccount = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { photo: true } });
  if (!user) return false;

  const closed = await cancelGiftsOf({ db: prisma, payments: getPaymentProvider() }, userId);
  const ended = await endPresence(redis, userId);
  if (ended) await publishPresenceEvent(redis, { type: "left", venueId: ended.venueId, userId });
  await redis.del(boostKey(userId));

  const [chats, hellos] = await Promise.all([
    prisma.chat.findMany({
      where: { OR: [{ userAId: userId }, { userBId: userId }] },
      select: { userAId: true, userBId: true },
    }),
    prisma.hello.findMany({
      where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: { fromUserId: true, toUserId: true },
    }),
  ]);
  const others = new Set<string>();
  for (const c of chats) others.add(c.userAId === userId ? c.userBId : c.userAId);
  for (const h of hellos) others.add(h.fromUserId === userId ? h.toUserId : h.fromUserId);
  for (const g of closed) {
    const other = g.fromUserId === userId ? g.toUserId : g.fromUserId;
    if (other) others.add(other);
  }

  await prisma.user.delete({ where: { id: userId } });
  if (user.photo) await getPhotoStorage().delete(user.photo);
  await publishUserEvent(redis, { type: "logout", userId });
  for (const other of others) await publishUserEvent(redis, { type: "refresh", userId: other });
  return true;
};
