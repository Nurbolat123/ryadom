import type { PrismaClient } from "@ryadom/db";
import type { Redis } from "ioredis";
import webpush from "web-push";
import { PUSH_TEXT, PUSH_URL, type PushKind } from "./texts";

/**
 * Web Push (VAPID). Отправляет realtime-сервис, когда у человека нет открытого на экране
 * приложения. В зашифрованном уведомлении только общий текст, адрес экрана и тег —
 * ни имён, ни фото, ни текстов сообщений, ни id людей.
 */
export type VapidConfig = { publicKey: string; privateKey: string; subject: string };

export const vapidFromEnv = (): VapidConfig | null => {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return null;
  return {
    publicKey: VAPID_PUBLIC_KEY,
    privateKey: VAPID_PRIVATE_KEY,
    subject: VAPID_SUBJECT || "mailto:support@ryadom.kz",
  };
};

export type PushTarget = { endpoint: string; keys: { p256dh: string; auth: string } };
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** Доставка одного уведомления. statusCode 404/410 — подписка больше не действует. */
export interface PushSender {
  send(
    target: PushTarget,
    payload: PushPayload,
  ): Promise<{ ok: true } | { ok: false; gone: boolean }>;
}

export class WebPushSender implements PushSender {
  constructor(
    private readonly vapid: VapidConfig,
    /** Для тестов: подменить сетевую отправку. */
    private readonly deliver: typeof webpush.sendNotification = webpush.sendNotification,
  ) {}

  options(payload: PushPayload): webpush.RequestOptions {
    return {
      vapidDetails: this.vapid,
      // Уведомление живёт час: позже «привет» уже не так актуален.
      TTL: 3600,
      urgency: "high",
      // Одинаковые события схлопываются у push-сервиса, пока устройство офлайн.
      topic: payload.tag,
    };
  }

  async send(target: PushTarget, payload: PushPayload) {
    try {
      await this.deliver(target, JSON.stringify(payload), this.options(payload));
      return { ok: true as const };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Адрес подписки и ответ сервиса в лог не пишем: в адресе токен устройства.
      console.warn(`[push] не доставлено: ${status ?? "сеть"}`);
      return { ok: false as const, gone: status === 404 || status === 410 };
    }
  }
}

/** Не чаще одного уведомления одного вида в минуту (сообщения в чате идут пачками). */
const THROTTLE_SECONDS = 60;
const throttleKey = (userId: string, kind: PushKind) => `push-throttle:${userId}:${kind}`;

export const buildPayload = (kind: PushKind, locale: "ru" | "kk"): PushPayload => ({
  ...PUSH_TEXT[locale][kind],
  url: PUSH_URL[kind],
  tag: kind,
});

/** Отправить уведомление на все устройства человека. Возвращает число доставленных. */
export const sendPush = async ({
  db,
  redis,
  sender,
  userId,
  kind,
}: {
  db: PrismaClient;
  redis: Redis;
  sender: PushSender;
  userId: string;
  kind: PushKind;
}) => {
  const subs = await db.pushSubscription.findMany({
    where: { userId, user: { bannedAt: null } },
    include: { user: { select: { locale: true } } },
  });
  if (!subs.length) return 0;
  if ((await redis.set(throttleKey(userId, kind), "1", "EX", THROTTLE_SECONDS, "NX")) !== "OK")
    return 0;
  let delivered = 0;
  for (const s of subs) {
    const res = await sender.send(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      buildPayload(kind, s.user.locale),
    );
    if (res.ok) {
      delivered++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastSentAt: new Date() } });
    } else if (res.gone) {
      await db.pushSubscription.deleteMany({ where: { id: s.id } });
    }
  }
  return delivered;
};
