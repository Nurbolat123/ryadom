import { describe, expect, it } from "vitest";
import {
  ageOn,
  BirthDateSchema,
  DisplayNameSchema,
  isAdult,
  maskPhone,
  normalizePhone,
} from "../src";

describe("телефон", () => {
  it.each([
    ["+7 (701) 123-45-67", "+77011234567"],
    ["8 701 123 45 67", "+77011234567"],
    ["77011234567", "+77011234567"],
    ["701 123 45 67", "+77011234567"],
    ["+998 90 123 45 67", "+998901234567"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "12345", "+7 701 123", "+7701123456789"])("отклоняет %s", (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  it("маскирует номер для логов", () => {
    expect(maskPhone("+77011234567")).toBe("+7701*****67");
    expect(maskPhone("+77011234567")).not.toContain("123456");
  });
});

describe("18+ (правило 10)", () => {
  it("18 исполняется ровно в день рождения", () => {
    expect(ageOn("2008-10-06", "2026-10-05")).toBe(17);
    expect(ageOn("2008-10-06", "2026-10-06")).toBe(18);
    expect(isAdult("2008-10-07", "2026-10-06")).toBe(false);
    expect(isAdult("2008-10-06", "2026-10-06")).toBe(true);
  });

  it("родившиеся 29 февраля взрослеют 1 марта", () => {
    expect(isAdult("2008-02-29", "2026-02-28")).toBe(false);
    expect(isAdult("2008-02-29", "2026-03-01")).toBe(true);
  });

  it("дата рождения должна быть настоящей", () => {
    expect(BirthDateSchema.safeParse("1999-02-30").success).toBe(false);
    expect(BirthDateSchema.safeParse("1890-01-01").success).toBe(false);
    expect(BirthDateSchema.safeParse("1999-12-31").success).toBe(true);
  });
});

describe("имя", () => {
  it("принимает русские и казахские имена", () => {
    for (const n of ["Айгерим", "Әсел", "Ұлан", "Анна-Мария", "John"]) {
      expect(DisplayNameSchema.safeParse(n).success).toBe(true);
    }
  });
  it("отклоняет ссылки, цифры и контакты в имени", () => {
    for (const n of ["@insta", "t.me/x", "Аня 8701", "А"]) {
      expect(DisplayNameSchema.safeParse(n).success).toBe(false);
    }
  });
});
