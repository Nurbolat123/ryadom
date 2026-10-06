import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient, findVenuesAtPoint } from "@ryadom/db";
import {
  approveVenueSuggestion,
  createVenueSuggestion,
  rejectVenueSuggestion,
  VenueSuggestionInputSchema,
} from "../src";

const db = createPrismaClient();
const NAME = `Тестовая кофейня ${Date.now()}`;

afterAll(async () => {
  const s = await db.venueSuggestion.findMany({
    where: { name: { startsWith: "Тестовая кофейня" } },
  });
  const venueIds = s.map((x) => x.venueId).filter((x): x is string => !!x);
  await db.venueSuggestion.deleteMany({ where: { id: { in: s.map((x) => x.id) } } });
  await db.venue.deleteMany({ where: { id: { in: venueIds } } });
  await db.$disconnect();
});

describe("«Нет моего заведения»", () => {
  it("не принимает координаты пользователя (правило 4)", () => {
    const r = VenueSuggestionInputSchema.safeParse({
      name: NAME,
      city: "astana",
      lat: 51.1,
      lng: 71.4,
    });
    expect(r.success).toBe(false);
  });

  it("не принимает неизвестный город и пустое название", () => {
    expect(VenueSuggestionInputSchema.safeParse({ name: NAME, city: "paris" }).success).toBe(false);
    expect(VenueSuggestionInputSchema.safeParse({ name: " ", city: "astana" }).success).toBe(false);
  });

  it("повтор того же места на проверке не создаёт дубль", async () => {
    const input = VenueSuggestionInputSchema.parse({
      name: NAME,
      city: "astana",
      category: "coffee",
    });
    const a = await createVenueSuggestion(db, input, null);
    const b = await createVenueSuggestion(db, { ...input, name: NAME.toUpperCase() }, null);
    expect(a.duplicate).toBe(false);
    expect(b).toEqual({ id: a.id, duplicate: true });
  });

  it("одобрение создаёт заведение с геозоной вокруг точки модератора", async () => {
    const s = await db.venueSuggestion.findFirstOrThrow({ where: { name: NAME } });
    const point: [number, number] = [71.4501, 51.1601];
    const { venueId, slug } = await approveVenueSuggestion(db, s.id, {
      lat: point[1],
      lng: point[0],
    });
    const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId } });
    expect(venue).toMatchObject({
      city: "Астана",
      source: "user",
      geofenceKind: "manual",
      isActive: true,
    });
    expect((await findVenuesAtPoint(db, point)).map((v) => v.slug)).toContain(slug);
    const after = await db.venueSuggestion.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.status).toBe("approved");
    await expect(approveVenueSuggestion(db, s.id, { lat: 51.16, lng: 71.45 })).rejects.toThrow(
      "уже рассмотрено",
    );
  });

  it("точку вне города одобрить нельзя", async () => {
    const { id } = await createVenueSuggestion(
      db,
      { name: `${NAME} 2`, city: "astana", category: "cafe" },
      null,
    );
    await expect(approveVenueSuggestion(db, id, { lat: 43.24, lng: 76.95 })).rejects.toThrow(
      "вне города",
    );
    await rejectVenueSuggestion(db, id);
    expect((await db.venueSuggestion.findUniqueOrThrow({ where: { id } })).status).toBe("rejected");
  });
});
