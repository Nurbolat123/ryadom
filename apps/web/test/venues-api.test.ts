import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@ryadom/db";
import { GET as listVenues } from "@/app/api/venues/route";
import { POST as suggest } from "@/app/api/venues/suggestions/route";
import { redis } from "@/lib/redis";

const NAME = `API-тест ${Date.now()}`;
// Уникальный IP на прогон, чтобы лимит не копился между запусками.
const IP = `10.0.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;

const post = (body: unknown, ip = IP) =>
  suggest(
    new Request("http://localhost/api/venues/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );

afterAll(async () => {
  await prisma.venueSuggestion.deleteMany({ where: { name: { startsWith: "API-тест" } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("GET /api/venues", () => {
  it("отдаёт заведения без координат и геозон (правило 4) и с указанием источника", async () => {
    const res = await listVenues(new Request("http://localhost/api/venues?city=almaty"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      venues: Record<string, unknown>[];
      attribution: { license: string };
    };
    expect(json.venues.length).toBeGreaterThan(0);
    const raw = JSON.stringify(json);
    for (const key of ["location", "geofence", "lat", "lng", "lon", "coordinates"]) {
      expect(raw).not.toContain(`"${key}"`);
    }
    expect(json.attribution.license).toBe("ODbL");
  });

  it("неизвестный город — 400", async () => {
    const res = await listVenues(new Request("http://localhost/api/venues?city=paris"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/venues/suggestions", () => {
  it("принимает предложение", async () => {
    const res = await post({ name: NAME, city: "astana", address: "пр. Мангилик Ел, 55" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ status: "pending" });
  });

  it("отклоняет координаты в запросе (правило 4)", async () => {
    const res = await post({ name: `${NAME} geo`, city: "astana", lat: 51.1, lng: 71.4 });
    expect(res.status).toBe(400);
    expect(await prisma.venueSuggestion.count({ where: { name: `${NAME} geo` } })).toBe(0);
  });

  it("не больше 5 предложений в сутки с одного адреса", async () => {
    const ip = `${IP}9`;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await post({ name: `${NAME} ${i}`, city: "astana" }, ip)).status);
    expect(statuses.slice(0, 5).every((s) => s === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});
