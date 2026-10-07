import { describe, expect, it } from "vitest";
import { activityBucket, localTimeIn, mentionsAlcohol, offerMentionsAlcohol } from "../src";

describe("активность заведений", () => {
  it("меньше 3 не показываем, дальше только диапазоны", () => {
    expect([0, 1, 2].map(activityBucket)).toEqual([null, null, null]);
    expect([3, 5, 6, 9, 10, 40].map(activityBucket)).toEqual([
      "3-5",
      "3-5",
      "5-10",
      "5-10",
      "10+",
      "10+",
    ]);
  });

  it("местное время заведения", () => {
    // 2026-10-05 — понедельник; 18:30 UTC = 23:30 в Алматы (UTC+5).
    expect(localTimeIn("Asia/Almaty", new Date("2026-10-05T18:30:00Z"))).toEqual({
      date: "2026-10-05",
      hour: 23,
      weekday: 0,
    });
    expect(localTimeIn("Asia/Almaty", new Date("2026-10-05T19:30:00Z"))).toMatchObject({
      date: "2026-10-06",
      hour: 0,
      weekday: 1,
    });
  });

  it("алкоголь в предложении замечается, обычные слова — нет", () => {
    for (const t of [
      "2 пива по цене 1",
      "Бокал вина в подарок",
      "Коктейли -20%",
      "Happy wine hour",
      "Ром-кола",
      "Шарап кеші",
    ])
      expect(mentionsAlcohol(t), t).toBe(true);
    for (const t of [
      "2 капучино по цене 1",
      "Винегрет дня",
      "Сырники со скидкой",
      "Пицца без сыра",
      "Вечер знакомств в 20:00",
      "Шоколадный торт",
    ])
      expect(mentionsAlcohol(t), t).toBe(false);
  });

  it("казахская «сыра» (пиво) — только в казахском тексте", () => {
    expect(offerMentionsAlcohol({ title: "Акция", titleKk: "Сыра тегін" })).toBe(true);
    expect(offerMentionsAlcohol({ title: "Паста без сыра" })).toBe(false);
    expect(offerMentionsAlcohol({ title: "Акция", descriptionKk: "Кофе мен тәтті" })).toBe(false);
  });
});
