import { z } from "zod";

/**
 * Виды push-уведомлений (этап 10). По виду выбирается общий текст без имён и текстов сообщений.
 * Событие пользователя (USER_CHANNEL) может нести вид — тогда realtime отправит push,
 * если приложение у человека сейчас не открыто на экране.
 */
export const PUSH_KINDS = ["hello", "gift", "sympathy", "match", "message", "plus"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** Подписка браузера (PushSubscription.toJSON()). Ключи — base64url. */
export const PushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(1000)
    .refine((u) => u.startsWith("https://"), "https only"),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{60,120}={0,2}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,40}={0,2}$/),
  }),
});
export const PushEndpointSchema = z.object({ endpoint: z.string().max(1000) });
