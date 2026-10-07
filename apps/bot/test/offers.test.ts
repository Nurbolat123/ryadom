import { createPrismaClient } from "@ryadom/db";
import { issueOfferCode } from "@ryadom/places";
import { afterAll, describe, expect, it } from "vitest";
import { createOfferCommands } from "../src/offers";

const db = createPrismaClient();
// Отдельное заведение и свой «чат», чтобы не мешать тесту заказов.
const venue = await db.venue.findUniqueOrThrow({ where: { slug: "kofe-kitap" } });
const other = await db.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const CHAT = "-100777";
const before = venue.telegramChatId;
await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: CHAT } });
const commands = createOfferCommands(db);

const offer = (venueId: string) =>
  db.offer.create({
    data: {
      venueId,
      type: "discount",
      placement: "badge",
      title: "Десерт к кофе в подарок",
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 86_400_000),
      status: "approved",
    },
  });
const mine = await offer(venue.id);
const foreign = await offer(other.id);

afterAll(async () => {
  await db.offer.deleteMany({ where: { id: { in: [mine.id, foreign.id] } } });
  await db.venue.update({ where: { id: venue.id }, data: { telegramChatId: before } });
  await db.$disconnect();
});

describe("предложения в боте заведения", () => {
  it("/redeem гасит код своего заведения один раз", async () => {
    const { code } = (await issueOfferCode(db, mine.id))!;
    expect(await commands.redeem(CHAT, code)).toContain("Код погашен");
    expect(await commands.redeem(CHAT, code)).toBe("Этот код уже погашен.");
  });

  it("код другого заведения не находится", async () => {
    const { code } = (await issueOfferCode(db, foreign.id))!;
    expect(await commands.redeem(CHAT, code)).toBe("Такого кода нет у этого заведения.");
  });

  it("в непривязанном чате ничего не работает", async () => {
    const { code } = (await issueOfferCode(db, mine.id))!;
    expect(await commands.redeem("-1", code)).toContain("не привязан");
    expect(await commands.report("-1")).toContain("не привязан");
  });

  it("/report — только счётчики", async () => {
    const text = await commands.report(CHAT);
    expect(text).toContain("Выдано кодов: ");
    expect(text).toMatch(/Погашено: [1-9]/);
  });
});
