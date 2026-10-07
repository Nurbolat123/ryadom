import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { endPresence, setOpenToMeet, startPresence, USER_CHANNEL } =
  await import("@ryadom/presence");
const { GET: key } = await import("@/app/api/push/key/route");
const sub = await import("@/app/api/push/subscribe/route");
const { POST: status } = await import("@/app/api/push/status/route");
const { POST: logout } = await import("@/app/api/auth/logout/route");
const { POST: hello } = await import("@/app/api/people/[id]/hello/route");
const { POST: like } = await import("@/app/api/people/[id]/sympathy/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");
const { banUser } = await import("@/lib/server/safety");

const TEPLYI = await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } });
const users: string[] = [];
const mkUser = async () => {
  const u = await prisma.user.create({
    data: {
      phone: `+7702${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: "Тест",
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
    },
  });
  users.push(u.id);
  return u.id;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const here = async (userId: string) => {
  const visit = await prisma.visit.create({ data: { userId, venueId: TEPLYI.id } });
  await startPresence(redis, userId, TEPLYI.id, visit.id);
  await setOpenToMeet(redis, userId, true);
};
const req = (method: string, body?: unknown) =>
  new Request("http://x", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const browser = () => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${Math.random().toString(36).slice(2)}`,
  keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
});
const subsOf = (userId: string) => prisma.pushSubscription.findMany({ where: { userId } });

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = "public-key";
  process.env.VAPID_PRIVATE_KEY = "private-key";
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("подписка на уведомления", () => {
  it("без VAPID-ключей push выключен: ключа нет, подписаться нельзя", async () => {
    await as(await mkUser());
    delete process.env.VAPID_PRIVATE_KEY;
    expect(await (await key()).json()).toEqual({ publicKey: null });
    expect((await sub.POST(req("POST", browser()))).status).toBe(503);
    process.env.VAPID_PRIVATE_KEY = "private-key";
    expect(await (await key()).json()).toEqual({ publicKey: "public-key" });
  });

  it("только вошедшим и только https-адреса push-сервисов", async () => {
    jar.clear();
    expect((await sub.POST(req("POST", browser()))).status).toBe(401);
    await as(await mkUser());
    const bad = { ...browser(), endpoint: "http://evil.example/push" };
    expect((await sub.POST(req("POST", bad))).status).toBe(400);
    expect((await sub.POST(req("POST", { endpoint: "https://x" }))).status).toBe(400);
  });

  it("включить, проверить, выключить; браузер переходит к тому, кто вошёл", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const br = browser();
    await as(a);
    expect((await sub.POST(req("POST", br))).status).toBe(201);
    expect(await (await status(req("POST", { endpoint: br.endpoint }))).json()).toEqual({
      subscribed: true,
    });

    // Тот же браузер, другой аккаунт: уведомления для a сюда больше не приходят.
    await as(b);
    expect(await (await status(req("POST", { endpoint: br.endpoint }))).json()).toEqual({
      subscribed: false,
    });
    await sub.POST(req("POST", br));
    expect(await subsOf(a)).toHaveLength(0);
    expect(await subsOf(b)).toHaveLength(1);

    // Чужую подписку выключить нельзя.
    await as(a);
    await sub.DELETE(req("DELETE", { endpoint: br.endpoint }));
    expect(await subsOf(b)).toHaveLength(1);
    await as(b);
    await sub.DELETE(req("DELETE", { endpoint: br.endpoint }));
    expect(await subsOf(b)).toHaveLength(0);
  });

  it("не больше 10 устройств: старые подписки удаляются", async () => {
    const a = await mkUser();
    await as(a);
    for (let i = 0; i < 12; i++) await sub.POST(req("POST", browser()));
    expect(await subsOf(a)).toHaveLength(10);
  });

  it("выход из аккаунта и бан удаляют подписки", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    const br = browser();
    await as(a);
    await sub.POST(req("POST", br));
    await sub.POST(req("POST", browser()));
    await logout(req("POST", { endpoint: br.endpoint }));
    expect((await subsOf(a)).map((s) => s.endpoint)).not.toContain(br.endpoint);
    expect(await subsOf(a)).toHaveLength(1);

    await as(b);
    await sub.POST(req("POST", browser()));
    await banUser(b);
    expect(await subsOf(b)).toHaveLength(0);
  });
});

describe("события для push: только вид, без данных о людях", () => {
  const listen = async () => {
    const s = redis.duplicate();
    const events: Record<string, unknown>[] = [];
    await s.subscribe(USER_CHANNEL);
    s.on("message", (_c, m) => events.push(JSON.parse(m)));
    return {
      events,
      stop: async () => {
        await new Promise((r) => setTimeout(r, 100));
        s.disconnect();
      },
    };
  };

  it("привет — получателю push «hello»; невзаимная симпатия — никаких событий (правило 5)", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    const bus = await listen();
    await as(a);
    expect((await hello(req("POST", { isSuper: false, message: "Привет!" }), ctx(b))).status).toBe(
      201,
    );
    await like(req("POST"), ctx(b));
    await bus.stop();
    expect(bus.events).toEqual([{ type: "inbox", userId: b, push: "hello" }]);
  });
});
