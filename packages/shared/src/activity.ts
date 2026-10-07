/**
 * «Где знакомятся сейчас» (этап 11): только диапазоны, меньше 3 не показываем,
 * без разбивки по полу и возрасту.
 */
export const ACTIVITY_BUCKETS = ["3-5", "5-10", "10+"] as const;
export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];

/** Меньше 3 открытых к знакомству — null: число не показывается вовсе. */
export const activityBucket = (openCount: number): ActivityBucket | null => {
  if (openCount < 3) return null;
  if (openCount <= 5) return "3-5";
  if (openCount < 10) return "5-10";
  return "10+";
};

/** Для сортировки: чем оживлённее, тем выше. */
export const activityRank = (b: ActivityBucket | null) => (b ? ACTIVITY_BUCKETS.indexOf(b) + 1 : 0);

/** Местные дата (YYYY-MM-DD), час 0–23 и день недели (0 — понедельник) в часовом поясе заведения. */
export const localTimeIn = (timeZone: string, now = new Date()) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday!);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday };
};

/**
 * Признаки алкоголя в тексте предложения: реклама алкоголя запрещена (законодательство РК).
 * Это подсказка модератору и защита от явных случаев, решение всё равно за модерацией.
 * Сравнение по словам: начала слов для длинных основ, целые слова для коротких.
 */
const ALCOHOL_STEMS = [
  "алкогол",
  "пив",
  "вин",
  "водк",
  "виски",
  "коньяк",
  "шампанск",
  "игрист",
  "ликер",
  "текил",
  "коктейл",
  "сидр",
  "мартини",
  "глинтвейн",
  "настойк",
  "бренди",
  "абсент",
  "шарап",
  "арақ",
  "beer",
  "wine",
  "vodka",
  "whisk",
  "cognac",
  "champagne",
  "tequila",
  "cocktail",
  "cider",
  "liquor",
  "liqueur",
  "alcohol",
  "brandy",
  "prosecco",
];
const ALCOHOL_WORDS = ["ром", "джин", "шот", "шоты", "rum", "gin", "shot", "shots", "бар-карта"];
/** Слова, которые начинаются как алкогольные основы, но ими не являются. */
const NOT_ALCOHOL = ["винегрет", "виноград", "винтаж", "винил", "пивоваров"];

const words = (texts: (string | null | undefined)[]) =>
  texts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^\p{L}-]+/u)
    .filter(Boolean)
    .flatMap((w) => (w.includes("-") ? [w, ...w.split("-")] : [w]));

export const mentionsAlcohol = (...texts: (string | null | undefined)[]) =>
  words(texts).some(
    (w) =>
      ALCOHOL_WORDS.includes(w) ||
      (ALCOHOL_STEMS.some((s) => w.startsWith(s)) && !NOT_ALCOHOL.some((n) => w.startsWith(n))),
  );

/** «Сыра» по-казахски — пиво, а по-русски — «сыр» в родительном падеже: проверяем только казахский текст. */
const ALCOHOL_STEMS_KK = ["сыра"];

/** Предложение целиком: русские и казахские тексты. */
export const offerMentionsAlcohol = (o: {
  title: string;
  description?: string | null;
  titleKk?: string | null;
  descriptionKk?: string | null;
}) =>
  mentionsAlcohol(o.title, o.description, o.titleKk, o.descriptionKk) ||
  words([o.titleKk, o.descriptionKk]).some((w) => ALCOHOL_STEMS_KK.some((s) => w.startsWith(s)));
