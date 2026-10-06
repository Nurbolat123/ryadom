import { RULES } from "./rules";

/** Сегодняшняя дата YYYY-MM-DD в часовом поясе (по умолчанию Казахстан). */
export const todayIn = (timeZone = "Asia/Almaty", now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

/** Полных лет на дату. Даты — строки YYYY-MM-DD. Родившиеся 29 февраля взрослеют 1 марта. */
export const ageOn = (birthDate: string, today: string): number => {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
};

export const isAdult = (birthDate: string, today: string = todayIn()): boolean =>
  ageOn(birthDate, today) >= RULES.minAge;
