import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => jar.get("locale") ?? "ru" }));

const { prisma } = await import("@ryadom/db");
const { endPresence, getPresence, startPresence } = await import("@ryadom/presence");
const { GET: people } = await import("@/app/api/here/people/route");
const { POST: setOpen } = await import("@/app/api/here/open/route");
const { GET: card } = await import("@/app/api/people/[id]/route");
const { GET: photo } = await import("@/app/api/people/[id]/photo/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");
const { setPhotoStorage } = await import("@/lib/server/storage");

const COORD_KEYS =
  /"(lat|lng|lon|latitude|longitude|location|geofence|accuracy|coordinates|distance)"/;

class MemoryStorage {
  files = new Map<string, Buffer>();
  async put(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async get(key: string) {
    return this.files.get(key) ?? null;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}
const storage = new MemoryStorage();
setPhotoStorage(storage);

const venue = async (slug: string) =>
  (await prisma.venue.findUniqueOrThrow({ where: { slug } })).id;
const TEPLYI = await venue("teplyi-ugol");
const POLKA = await venue("bar-polka");
const interestIds = (
  await prisma.interest.findMany({ orderBy: { sortOrder: "asc" }, take: 6 })
).map((i) => i.id);

const users: string[] = [];
const mkUser = async (opts: { name?: string; verified?: boolean; interests?: number[] } = {}) => {
  const u = await prisma.user.create({
    data: {
      phone: `+7705${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: opts.name ?? "Тест",
      about: "Люблю кофе",
      photo: `u/${Math.random()}/photo.webp`,
      verifiedAt: opts.verified === false ? null : new Date(),
      interests: { create: (opts.interests ?? []).map((i) => ({ interestId: interestIds[i]! })) },
    },
  });
  users.push(u.id);
  await storage.put(u.photo!, Buffer.from("webp"));
  return u;
};
const loginAs = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
/** Отметиться в заведении и (по желанию) включить «Открыт(а)». */
const here = async (userId: string, venueId: string, open = true) => {
  await startPresence(redis, userId, venueId, "visit");
  if (open) {
    await loginAs(userId);
    expect((await setOpen(post({ open: true }))).status).toBe(200);
  }
};
const post = (body: unknown) =>
  new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
type Body = {
  open: boolean;
  people: { id: string; name: string; common: string[]; interests: { common: boolean }[] }[];
};
const list = async (viewerId: string) => {
  await loginAs(viewerId);
  const res = await people();
  return { status: res.status, text: await res.text() };
};
const ids = (text: string) => (JSON.parse(text) as Body).people.map((p) => p.id);

beforeEach(async () => {
  jar.clear();
  // Каждый тест начинает с пустого «Тёплого угла».
  for (const id of users) await endPresence(redis, id);
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  setPhotoStorage(null);
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("список людей", () => {
  it("без входа — 401, без отметки — 403", async () => {
    expect((await people()).status).toBe(401);
    const a = await mkUser();
    expect((await list(a.id)).status).toBe(403);
    await loginAs(a.id);
    expect((await setOpen(post({ open: true }))).status).toBe(403);
  });

  it("пока сам(а) не открыт(а) — список пуст (правило 2)", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(b.id, TEPLYI);
    await here(a.id, TEPLYI, false);
    const { status, text } = await list(a.id);
    expect(status).toBe(200);
    expect(JSON.parse(text)).toEqual({ open: false, people: [] });
    expect((await getPresence(redis, a.id))?.openToMeet).toBe(false);
  });

  it("видны только открытые, с проверенным селфи, из этого же заведения", async () => {
    const viewer = await mkUser();
    const open = await mkUser({ name: "Открытая" });
    const closed = await mkUser();
    const unverified = await mkUser({ verified: false });
    const elsewhere = await mkUser();
    await here(open.id, TEPLYI);
    await here(closed.id, TEPLYI, false);
    await here(unverified.id, TEPLYI);
    await here(elsewhere.id, POLKA);
    await here(viewer.id, TEPLYI);
    const { text } = await list(viewer.id);
    expect(ids(text)).toEqual([open.id]);
    expect(text).not.toMatch(COORD_KEYS);
    expect(text).not.toMatch(/phone|birthDate|\+7/);
  });

  it("блокировка в любую сторону скрывает человека (правило 9)", async () => {
    const [viewer, b, c] = [await mkUser(), await mkUser(), await mkUser()];
    await prisma.block.create({ data: { blockerId: viewer.id, blockedId: b.id } });
    await prisma.block.create({ data: { blockerId: c.id, blockedId: viewer.id } });
    for (const u of [b, c, viewer]) await here(u.id, TEPLYI);
    expect(ids((await list(viewer.id)).text)).toEqual([]);
    await loginAs(viewer.id);
    expect((await card(new Request("http://x"), params(b.id))).status).toBe(404);
    expect((await photo(new Request("http://x"), params(c.id))).status).toBe(404);
  });

  it("сначала те, с кем больше общего, и подпись «Общее: …»", async () => {
    const viewer = await mkUser({ interests: [0, 1, 2] });
    const none = await mkUser({ interests: [4, 5] });
    const two = await mkUser({ interests: [5, 1, 2] });
    const one = await mkUser({ interests: [0, 4] });
    for (const u of [none, two, one, viewer]) await here(u.id, TEPLYI);
    const body = JSON.parse((await list(viewer.id)).text) as Body;
    expect(body.people.map((p) => p.id)).toEqual([two.id, one.id, none.id]);
    expect(body.people[0]!.common).toHaveLength(2);
    expect(body.people[0]!.interests.map((i) => i.common)).toEqual([true, true, false]);
    expect(body.people[2]!.common).toEqual([]);
  });

  it("интересы на казахском, если выбран kk", async () => {
    const viewer = await mkUser({ interests: [0] });
    const b = await mkUser({ interests: [0] });
    for (const u of [b, viewer]) await here(u.id, TEPLYI);
    await loginAs(viewer.id);
    jar.set("locale", "kk");
    const kk = await prisma.interest.findUniqueOrThrow({ where: { id: interestIds[0]! } });
    expect(((await (await people()).json()) as Body).people[0]!.common).toEqual([kk.nameKk]);
  });
});

describe("карточка и фото", () => {
  it("доступны только в одном заведении, пока оба открыты", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(b.id, TEPLYI);
    await here(a.id, TEPLYI);
    await loginAs(a.id);
    const res = await card(new Request("http://x"), params(b.id));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text).person).toMatchObject({
      id: b.id,
      age: expect.any(Number),
      about: "Люблю кофе",
    });
    expect(text).not.toMatch(COORD_KEYS);
    const ph = await photo(new Request("http://x"), params(b.id));
    expect(ph.status).toBe(200);
    expect(ph.headers.get("cache-control")).toContain("no-store");

    // b выключил «Открыт(а)» — карточка и фото пропадают.
    await loginAs(b.id);
    await setOpen(post({ open: false }));
    await loginAs(a.id);
    expect((await card(new Request("http://x"), params(b.id))).status).toBe(404);
    expect((await photo(new Request("http://x"), params(b.id))).status).toBe(404);

    // b ушёл в другое заведение.
    await here(b.id, POLKA);
    await loginAs(a.id);
    expect((await card(new Request("http://x"), params(b.id))).status).toBe(404);

    // Ушёл совсем.
    await endPresence(redis, b.id);
    expect((await photo(new Request("http://x"), params(b.id))).status).toBe(404);
  });
});

describe("переключатель «Открыт(а)»", () => {
  it("пишет обезличенную аналитику и событие в шину", async () => {
    const a = await mkUser();
    await startPresence(redis, a.id, TEPLYI, "visit");
    const sub = redis.duplicate();
    const messages: string[] = [];
    await sub.subscribe("ryadom:presence");
    sub.on("message", (_c, m) => messages.push(m));
    const before = await prisma.analyticsEvent.count({
      where: { type: "open_to_meet_on", venueId: TEPLYI },
    });
    await loginAs(a.id);
    const res = await setOpen(post({ open: true }));
    expect(await res.json()).toEqual({ openToMeet: true });
    expect(
      await prisma.analyticsEvent.count({ where: { type: "open_to_meet_on", venueId: TEPLYI } }),
    ).toBe(before + 1);
    await setOpen(post({ open: false }));
    await new Promise((r) => setTimeout(r, 100));
    sub.disconnect();
    expect(messages.map((m) => JSON.parse(m).type)).toEqual(["open", "closed"]);
    expect(messages.join()).not.toMatch(COORD_KEYS);
  });

  it("неверное тело — 400", async () => {
    const a = await mkUser();
    await startPresence(redis, a.id, TEPLYI, "visit");
    await loginAs(a.id);
    expect((await setOpen(post({ open: "yes" }))).status).toBe(400);
  });
});
