import { describe, expect, it } from "vitest";
import { commissionOf, toMinor } from "../src";

describe("money", () => {
  it("хранит суммы в тиынах", () => {
    expect(toMinor(490)).toBe(49000);
  });

  it("считает комиссию 12% с округлением вниз", () => {
    expect(commissionOf(toMinor(1990), 12)).toBe(23880);
    expect(commissionOf(1, 12)).toBe(0);
  });
});
