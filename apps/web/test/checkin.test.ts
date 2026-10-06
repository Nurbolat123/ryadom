import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { jar } from "./cookies-mock";

const { prisma } = await import("@ryadom/db");
const { setOpenToMeet, startPresence, endPresence } = await import("@ryadom/presence");
const { POST: locate } = await import("@/app/api/checkin/locate/route");
const { GET: current, POST: confirm, DELETE: leave } = await import("@/app/api/checkin/route");
const { POST: recheck } = await import("@/app/api/checkin/recheck/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");

// Точки у сидовых заведений Алматы.
const TEPLYI = { lat: 43.2399, lng: 76.9464, accuracy: 15 }; // ~24 м от центра, ~49 м от «Полки»
const BOTH = { lat: 43.2399, lng: 76.94685, accuracy: 15 }; // между «Тёплым углом» и «Полкой»
const OUTSIDE = { lat: 43.245, lng: 76.93, accuracy: 10 };
const COORD_KEYS = /"(lat|lng|lon|latitude|longitude|location|geofence|accuracy|coordinates)"/;

const users: string[] = [];
const mkUser = async (verified = true) => {
  const u = await prisma.user.create({
    data: {
      phone: `+7703${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Тест",
      photo: "u/test/photo.webp",
      verifiedAt: verified ? new Date() : null,
    },
  });
  users.push(u.id);
  return u;
};
const loginAs = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

const venueId = async (slug: string) =>
  (await prisma.venue.findUniqueOrThrow({ where: { slug } })).id;

beforeEach(() => jar.clear());
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("определение заведения", () => {
  it("точность хуже 50 м — просим подойти ближе к окну", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    const res = await locate(post({ ...TEPLYI, accuracy: 80 }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "low_accuracy" });
  });

  it("одно заведение — один кандидат, без координат в ответе (правило 4)", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    const res = await locate(post(TEPLYI));
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(JSON.parse(text).venues.map((v: { slug: string }) => v.slug)).toEqual(["teplyi-ugol"]);
    expect(text).not.toMatch(COORD_KEYS);
  });

  it("несколько рядом — список, ближайшее первым", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    const { venues } = (await (
      await locate(post({ ...BOTH, lng: BOTH.lng - 0.00005 }))
    ).json()) as {
      venues: { slug: string }[];
    };
    expect(venues.map((v) => v.slug)).toEqual(["teplyi-ugol", "bar-polka"]);
  });

  it("вне заведений — пусто", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    expect(await (await locate(post(OUTSIDE))).json()).toEqual({ venues: [] });
  });

  it("точка пользователя не попадает в Redis", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    await locate(post(TEPLYI));
    for (const key of await redis.keys(`*${u.id}*`)) {
      const type = await redis.type(key);
      const dump =
        type === "set"
          ? (await redis.smembers(key)).join()
          : type === "string"
            ? await redis.get(key)
            : "";
      expect(dump ?? "").not.toContain("43.2399");
      expect(dump ?? "").not.toContain("76.946");
    }
  });
});

describe("подтверждение чек-ина (правило 1)", () => {
  it("нельзя отметиться в заведении, не побывав в его геозоне (удалённо, по ссылке)", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    expect((await confirm(post({ venueId: await venueId("sad-na-panfilova") }))).status).toBe(403);
    await locate(post(OUTSIDE));
    expect((await confirm(post({ venueId: await venueId("teplyi-ugol") }))).status).toBe(403);
  });

  it("нельзя выбрать заведение из старого поиска, если новый показал другое место", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    await locate(post(TEPLYI));
    await locate(post({ lat: 43.2565, lng: 76.9443, accuracy: 20 })); // Сад на Панфилова
    expect((await confirm(post({ venueId: await venueId("teplyi-ugol") }))).status).toBe(403);
  });

  it("без селфи-проверки отметиться нельзя", async () => {
    const u = await mkUser(false);
    await loginAs(u.id);
    await locate(post(TEPLYI));
    const res = await confirm(post({ venueId: await venueId("teplyi-ugol") }));
    expect(res.status).toBe(409);
  });

  it("чек-ин: режим «открыт(а)» выключен, присутствие на 2 часа, визит и обезличенная аналитика", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    await locate(post(TEPLYI));
    const before = await prisma.analyticsEvent.count({ where: { type: "checkin" } });
    const res = await confirm(post({ venueId: await venueId("teplyi-ugol") }));
    const text = await res.text();
    expect(res.status).toBe(201);
    expect(text).not.toMatch(COORD_KEYS);
    const { checkin } = JSON.parse(text);
    expect(checkin.venue.slug).toBe("teplyi-ugol");
    expect(checkin.openToMeet).toBe(false);
    const ttlMin = (Date.parse(checkin.expiresAt) - Date.now()) / 60000;
    expect(ttlMin).toBeGreaterThan(119);
    expect(ttlMin).toBeLessThanOrEqual(120);
    expect(await prisma.visit.count({ where: { userId: u.id, endedAt: null } })).toBe(1);
    expect(await prisma.analyticsEvent.count({ where: { type: "checkin" } })).toBe(before + 1);
    // кандидаты одноразовые
    expect((await confirm(post({ venueId: await venueId("teplyi-ugol") }))).status).toBe(403);
  });

  it("«Я ушёл(ла)» завершает присутствие и визит", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    await locate(post(TEPLYI));
    await confirm(post({ venueId: await venueId("teplyi-ugol") }));
    expect((await leave()).status).toBe(200);
    expect(await (await current()).json()).toEqual({ checkin: null });
    expect(await prisma.visit.count({ where: { userId: u.id, endedAt: null } })).toBe(0);
  });
});

describe("перепроверка при повторном открытии (правило 3)", () => {
  it("вне геозоны — присутствие завершается; плохая точность — остаётся", async () => {
    const u = await mkUser();
    await loginAs(u.id);
    await locate(post(TEPLYI));
    await confirm(post({ venueId: await venueId("teplyi-ugol") }));
    expect(await (await recheck(post(TEPLYI))).json()).toEqual({ status: "here" });
    expect(await (await recheck(post({ ...OUTSIDE, accuracy: 300 }))).json()).toEqual({
      status: "uncertain",
    });
    expect(await (await recheck(post(OUTSIDE))).json()).toEqual({ status: "left" });
    expect(await (await current()).json()).toEqual({ checkin: null });
  });
});

describe("«Здесь сейчас N человек открыты к знакомству»", () => {
  it("показывается только при N ≥ 3", async () => {
    const vid = await venueId("kofe-kitap");
    const me = await mkUser();
    await loginAs(me.id);
    await locate(post({ lat: 43.2339, lng: 76.9578, accuracy: 10 }));
    await confirm(post({ venueId: vid }));

    const others = [await mkUser(), await mkUser(), await mkUser()];
    for (const o of others) await startPresence(redis, o.id, vid, "v");
    await setOpenToMeet(redis, others[0]!.id, true);
    await setOpenToMeet(redis, others[1]!.id, true);
    let body = (await (await current()).json()) as { checkin: { openCount: number | null } };
    expect(body.checkin.openCount).toBeNull();

    await setOpenToMeet(redis, others[2]!.id, true);
    body = (await (await current()).json()) as { checkin: { openCount: number | null } };
    expect(body.checkin.openCount).toBe(3);
  });
});

describe("без входа", () => {
  it("API чек-ина закрыто", async () => {
    expect((await locate(post(TEPLYI))).status).toBe(401);
    expect((await current()).status).toBe(401);
  });
});
