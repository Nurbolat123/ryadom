/**
 * Тексты бота для персонала на русском и казахском. Язык — у заведения (Venue.staffLocale),
 * меняется командой /lang kk|ru в привязанном чате или в админке.
 * В текстах нет имён, фото и записок гостей — только позиция, код и столик.
 */
export type StaffLocale = "ru" | "kk";

type Texts = {
  start: string;
  linkUsage: string;
  linked: (venue: string) => string;
  linkFailed: string;
  notLinked: string;
  langUsage: string;
  langSet: string;
  redeemUsage: string;
  redeemed: (title: string) => string;
  redeemError: { not_found: string; used: string; expired: string };
  report: (r: {
    venue: string;
    days: number;
    impressions: number;
    clicks: number;
    codesIssued: number;
    redemptions: number;
  }) => string;
  order: (o: {
    item: string;
    pickupCode: string | null;
    delivery: "pickup" | "table" | null;
    tableNumber: string | null;
  }) => string;
  redeemButton: string;
  unknownButton: string;
  alreadyRedeemed: string;
  orderNotFound: string;
  markedRedeemed: string;
  redeemedSuffix: string;
};

export const TEXTS: Record<StaffLocale, Texts> = {
  ru: {
    start:
      "Бот заведения «рядом». Сюда приходят заказы подарков для гостей.\n" +
      "Чтобы привязать этот чат к заведению, отправьте /link КОД (код выдаёт администратор «рядом»).\n" +
      "Гость показал код скидки — отправьте /redeem КОД. Отчёт по предложениям — /report.\n" +
      "Язык бота: /lang kk — қазақша, /lang ru — по-русски.",
    linkUsage: "Отправьте: /link КОД",
    linked: (venue) => `Готово: этот чат получает заказы подарков заведения «${venue}».`,
    linkFailed: "Код не подошёл или истёк. Попросите новый.",
    notLinked: "Этот чат не привязан к заведению. Отправьте /link КОД.",
    langUsage: "Отправьте: /lang ru или /lang kk",
    langSet: "Готово: бот пишет по-русски.",
    redeemUsage: "Отправьте: /redeem КОД",
    redeemed: (title) => `✓ Код погашен: «${title}».`,
    redeemError: {
      not_found: "Такого кода нет у этого заведения.",
      used: "Этот код уже погашен.",
      expired: "Срок действия кода истёк.",
    },
    report: (r) =>
      [
        `«${r.venue}»: предложения за ${r.days} дней`,
        `Показы: ${r.impressions}`,
        `Переходы: ${r.clicks}`,
        `Выдано кодов: ${r.codesIssued}`,
        `Погашено: ${r.redemptions}`,
      ].join("\n"),
    order: (o) =>
      [
        "🎁 Подарок для гостя",
        `Позиция: ${o.item}`,
        `Код выдачи: ${o.pickupCode ?? "—"}`,
        o.delivery === "table"
          ? `Принести за столик ${o.tableNumber}`
          : "Гость заберёт у стойки по коду",
        "Оплачено через «рядом».",
      ].join("\n"),
    redeemButton: "Выдано",
    unknownButton: "Неизвестная кнопка",
    alreadyRedeemed: "Этот подарок уже выдан или отменён.",
    orderNotFound: "Заказ не найден.",
    markedRedeemed: "Отмечено: выдано ✓",
    redeemedSuffix: "✓ Выдано",
  },
  kk: {
    start:
      "«рядом» орнының боты. Мұнда қонақтарға арналған сыйлық тапсырыстары келеді.\n" +
      "Бұл чатты орынға байлау үшін /link КОД жіберіңіз (кодты «рядом» әкімшісі береді).\n" +
      "Қонақ жеңілдік кодын көрсетсе — /redeem КОД жіберіңіз. Ұсыныстар есебі — /report.\n" +
      "Бот тілі: /lang kk — қазақша, /lang ru — по-русски.",
    linkUsage: "Жіберіңіз: /link КОД",
    linked: (venue) => `Дайын: бұл чатқа «${venue}» орнының сыйлық тапсырыстары келеді.`,
    linkFailed: "Код сәйкес келмеді немесе мерзімі өтті. Жаңасын сұраңыз.",
    notLinked: "Бұл чат орынға байланбаған. /link КОД жіберіңіз.",
    langUsage: "Жіберіңіз: /lang kk немесе /lang ru",
    langSet: "Дайын: бот қазақша жазады.",
    redeemUsage: "Жіберіңіз: /redeem КОД",
    redeemed: (title) => `✓ Код өтелді: «${title}».`,
    redeemError: {
      not_found: "Бұл орында мұндай код жоқ.",
      used: "Бұл код өтеліп қойған.",
      expired: "Кодтың мерзімі өтті.",
    },
    report: (r) =>
      [
        `«${r.venue}»: соңғы ${r.days} күндегі ұсыныстар`,
        `Көрсетілім: ${r.impressions}`,
        `Өтулер: ${r.clicks}`,
        `Берілген кодтар: ${r.codesIssued}`,
        `Өтелгені: ${r.redemptions}`,
      ].join("\n"),
    order: (o) =>
      [
        "🎁 Қонаққа сыйлық",
        `Позиция: ${o.item}`,
        `Беру коды: ${o.pickupCode ?? "—"}`,
        o.delivery === "table"
          ? `${o.tableNumber}-үстелге апару`
          : "Қонақ кассадан код бойынша алады",
        "«рядом» арқылы төленді.",
      ].join("\n"),
    redeemButton: "Берілді",
    unknownButton: "Белгісіз батырма",
    alreadyRedeemed: "Бұл сыйлық берілген немесе тоқтатылған.",
    orderNotFound: "Тапсырыс табылмады.",
    markedRedeemed: "Белгіленді: берілді ✓",
    redeemedSuffix: "✓ Берілді",
  },
};

export const textsFor = (locale: string | null | undefined): Texts =>
  TEXTS[locale === "kk" ? "kk" : "ru"];
