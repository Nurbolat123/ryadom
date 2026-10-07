import type { Locale } from "@ryadom/db";
import type { PushKind } from "@ryadom/shared";

export { PUSH_KINDS, type PushKind } from "@ryadom/shared";

/**
 * Тексты уведомлений. Realtime-сервис не использует next-intl, поэтому они здесь, рядом
 * с отправкой; ключи совпадают с PushKind. Тон — как в интерфейсе: на «ты», без давления.
 * В тексте нет ничего, по чему можно узнать человека (правила 5 и 12): уведомление
 * проходит через push-сервис браузера (Google, Apple, Mozilla), пусть и в зашифрованном виде.
 */
export const PUSH_TEXT: Record<Locale, Record<PushKind, { title: string; body: string }>> = {
  ru: {
    hello: { title: "рядом", body: "Тебе пришёл привет" },
    gift: { title: "рядом", body: "Тебя хотят угостить" },
    sympathy: { title: "рядом", body: "Кому-то здесь ты понравился(лась)" },
    match: { title: "рядом", body: "Вы понравились друг другу. Подойди и поздоровайся" },
    message: { title: "рядом", body: "Новое сообщение в чате" },
    plus: { title: "рядом", body: "Новости о твоём «Плюс»" },
  },
  kk: {
    hello: { title: "рядом", body: "Саған сәлем келді" },
    gift: { title: "рядом", body: "Біреу сені сыйлағысы келеді" },
    sympathy: { title: "рядом", body: "Осы жерде біреуге ұнадың" },
    match: { title: "рядом", body: "Сендер бір-біріңе ұнадыңдар. Жақындап, амандас" },
    message: { title: "рядом", body: "Чатта жаңа хабарлама" },
    plus: { title: "рядом", body: "«Плюс» туралы жаңалық" },
  },
};

/** Куда открыть приложение по нажатию. */
export const PUSH_URL: Record<PushKind, string> = {
  hello: "/inbox",
  gift: "/inbox",
  sympathy: "/inbox",
  match: "/inbox",
  message: "/inbox",
  plus: "/plus",
};
