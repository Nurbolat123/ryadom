import { prisma } from "@ryadom/db";
import { RULES, type PushSubscriptionSchema } from "@ryadom/shared";
import type { z } from "zod";
import { rateLimit } from "../rate-limit";

/**
 * Подписки на Web Push. Отправляет уведомления realtime-сервис (пакет @ryadom/push),
 * здесь только сохранить и удалить подписку браузера.
 * Без VAPID-ключей в .env push выключен, и интерфейс не предлагает его включить.
 */
export const pushPublicKey = () =>
  process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? process.env.VAPID_PUBLIC_KEY
    : null;

export const subscribePush = async (
  userId: string,
  sub: z.infer<typeof PushSubscriptionSchema>,
) => {
  if (!pushPublicKey()) return { ok: false as const, error: "push_unavailable" as const };
  if (!(await rateLimit("push-sub", userId, RULES.pushSubscribesPerHour, 3600)).ok)
    return { ok: false as const, error: "rate_limited" as const };
  // Браузер мог принадлежать другому аккаунту — подписка переходит к тому, кто вошёл сейчас.
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  // Не больше 10 устройств: самые старые подписки удаляются.
  const extra = await prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: RULES.pushDevicesPerUser,
    select: { id: true },
  });
  if (extra.length)
    await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
  return { ok: true as const };
};

export const unsubscribePush = (userId: string, endpoint: string) =>
  prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });

export const hasPushSubscription = async (userId: string, endpoint: string) =>
  !!(await prisma.pushSubscription.findFirst({
    where: { userId, endpoint },
    select: { id: true },
  }));
