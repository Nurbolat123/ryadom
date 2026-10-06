import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { endPresence, getPresence, NOTICE_QUEUE_KEY, setOpenToMeet, startPresence, USER_CHANNEL } =
  await import("@ryadom/presence");
const sympathy = await import("@/app/api/people/[id]/sympathy/route");
const { POST: hello } = await import("@/app/api/people/[id]/hello/route");
const { POST: block } = await import("@/app/api/people/[id]/block/route");
const { POST: report } = await import("@/app/api/people/[id]/report/route");
const { GET: people } = await import("@/app/api/here/people/route");
const { GET: card } = await import("@/app/api/people/[id]/route");
const { GET: photo } = await import("@/app/api/people/[id]/photo/route");
const { GET: inbox } = await import("@/app/api/inbox/route");
const { GET: badges } = await import("@/app/api/badges/route");
const { GET: chats } = await import("@/app/api/chats/route");
const { GET: chat } = await import("@/app/api/chats/[id]/route");
const { POST: send } = await import("@/app/api/chats/[id]/messages/route");
const { POST: contacts } = await import("@/app/api/chats/[id]/contacts/route");
const { GET: adminReports } = await import("@/app/api/admin/reports/route");
const { POST: resolve } = await import("@/app/api/admin/reports/[id]/route");
const { GET: adminPhoto } = await import("@/app/api/admin/users/[id]/photo/route");
const { POST: requestCode } = await import("@/app/api/auth/code/route");
const { POST: verify } = await import("@/app/api/auth/verify/route");
const { redis } = await import("@/lib/redis");
const { getSession, startSession } = await import("@/lib/server/session");
const { setPhotoStorage } = await import("@/lib/server/storage");
const { setSmsProvider } = await import("@/lib/server/sms");

const deletedPhotos: string[] = [];
setPhotoStorage({
  put: async () => undefined,
  get: async () => Buffer.from("webp"),
  delete: async (key: string) => void deletedPhotos.push(key),
});
const codes = new Map<string, string>();
setSmsProvider({ sendCode: async (phone, code) => void codes.set(phone, code) });

const TEPLYI = (await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } })).id;
const POLKA = (await prisma.venue.findUniqueOrThrow({ where: { slug: "bar-polka" } })).id;

const users: string[] = [];
const mkUser = async (name = "Тест", role: "user" | "admin" = "user") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7709${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: name,
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
      role,
    },
  });
  users.push(u.id);
  return u;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const here = async (userId: string, venueId = TEPLYI) => {
  await startPresence(redis, userId, venueId, `visit-${userId}-${venueId}`);
  await setOpenToMeet(redis, userId, true);
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    headers: { "x-forwarded-for": `10.7.${Math.floor(Math.random() * 250)}.1` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const statusOf = async (p: Promise<Response>) => (await p).status;

/** Всё, что user видит в API о себе и о других: список, входящие, значки, чаты. */
const everythingSeenBy = async (userId: string) => {
  await as(userId);
  return [people(), inbox(), badges(), chats()].reduce(
    async (acc, p) => (await acc) + "\n" + (await (await p).text()),
    Promise.resolve(""),
  );
};

/** Подслушать шину личных событий. */
const listen = async () => {
  const sub = redis.duplicate();
  const events: { type: string; userId: string; chatId?: string }[] = [];
  await sub.subscribe(USER_CHANNEL);
  sub.on("message", (_c, m) => events.push(JSON.parse(m)));
  return {
    events,
    stop: async () => {
      await new Promise((r) => setTimeout(r, 100));
      sub.disconnect();
    },
  };
};

beforeEach(async () => {
  jar.clear();
  for (const id of users) await endPresence(redis, id);
  await redis.del(NOTICE_QUEUE_KEY);
});
afterAll(async () => {
  for (const id of users) await endPresence(redis, id);
  await prisma.report.deleteMany({ where: { reportedId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("блокировка: заблокированного не видно нигде (правило 9)", () => {
  it("в заведении: список, карточка, фото, симпатия, привет, входящие — в обе стороны", async () => {
    const [a, b, c] = [await mkUser("Аня"), await mkUser("Боря"), await mkUser("Вика")];
    for (const u of [a, b, c]) await here(u.id);

    // До блокировки: b написал(а) a привет и поставил(а) сердечко; a тоже отметил(а) b.
    await as(b.id);
    expect(await statusOf(hello(req({ isSuper: false, message: "Привет!" }), ctx(a.id)))).toBe(201);
    expect(await statusOf(sympathy.POST(req(), ctx(a.id)))).toBe(200);
    await as(a.id);
    expect((await (await inbox()).text()).includes(b.id)).toBe(true);

    const bus = await listen();
    expect(await statusOf(block(req(), ctx(b.id)))).toBe(200);
    await bus.stop();

    // Обоим — «обновить всё», и в событии никого, кроме адресата.
    expect(bus.events.map((e) => e.userId).sort()).toEqual([a.id, b.id].sort());
    for (const e of bus.events) {
      expect(e.type).toBe("refresh");
      expect(Object.keys(e).sort()).toEqual(["type", "userId"]);
    }

    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      expect(await everythingSeenBy(me.id)).not.toContain(other.id);
      expect(await statusOf(card(req(), ctx(other.id)))).toBe(404);
      expect(await statusOf(photo(req(), ctx(other.id)))).toBe(404);
      expect(await statusOf(sympathy.POST(req(), ctx(other.id)))).toBe(404);
      expect(
        await statusOf(hello(req({ isSuper: false, message: "Ещё раз" }), ctx(other.id))),
      ).toBe(404);
    }

    // Симпатии удалены (не станут взаимными), ожидающий привет тихо закрыт.
    expect(
      await prisma.sympathy.count({
        where: { fromUserId: { in: [a.id, b.id] }, toUserId: { in: [a.id, b.id] } },
      }),
    ).toBe(0);
    expect((await prisma.hello.findFirstOrThrow({ where: { fromUserId: b.id } })).status).toBe(
      "dismissed",
    );

    // Третий человек по-прежнему видит обоих.
    const seenByC = await everythingSeenBy(c.id);
    expect(seenByC).toContain(a.id);
    expect(seenByC).toContain(b.id);

    // В другом заведении — тоже не видно (навсегда, везде).
    for (const u of [a, b, c]) await here(u.id, POLKA);
    expect(await everythingSeenBy(a.id)).not.toContain(b.id);
    expect(await everythingSeenBy(b.id)).not.toContain(a.id);
  });

  it("в чате: чат пропадает у обоих, сообщения и контакты закрыты", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a.id);
    await here(b.id);
    await as(a.id);
    await sympathy.POST(req(), ctx(b.id));
    await as(b.id);
    const { chatId } = (await (await sympathy.POST(req(), ctx(a.id))).json()) as { chatId: string };
    expect(await statusOf(send(req({ body: "Привет" }), ctx(chatId)))).toBe(201);

    // b ушёл(ла) из заведения и блокирует a из чата.
    await endPresence(redis, b.id);
    expect(await statusOf(block(req(), ctx(a.id)))).toBe(200);

    for (const [me, other] of [
      [a, b],
      [b, a],
    ] as const) {
      expect(await everythingSeenBy(me.id)).not.toContain(other.id);
      expect(await everythingSeenBy(me.id)).not.toContain(chatId);
      expect(await statusOf(chat(req(), ctx(chatId)))).toBe(404);
      expect(await statusOf(send(req({ body: "Эй" }), ctx(chatId)))).toBe(404);
      expect(await statusOf(contacts(req(), ctx(chatId)))).toBe(404);
      expect(await statusOf(photo(req(), ctx(other.id)))).toBe(404);
    }
  });

  it("заблокировать можно только того, кого видишь или с кем переписка", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await as(a.id);
    expect(await statusOf(block(req(), ctx(b.id)))).toBe(404);
    expect(await statusOf(block(req(), ctx(a.id)))).toBe(404);
    expect(await statusOf(block(req(), ctx("no-such-user")))).toBe(404);
    expect(await prisma.block.count({ where: { blockerId: a.id } })).toBe(0);
  });
});

describe("жалоба", () => {
  it("по умолчанию сразу блокирует; заведение — только если оба в нём", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a.id);
    await here(b.id);
    await as(a.id);
    expect(
      await statusOf(report(req({ reason: "harassment", comment: "грубит" }), ctx(b.id))),
    ).toBe(201);
    const r = await prisma.report.findFirstOrThrow({ where: { reporterId: a.id } });
    expect(r).toMatchObject({
      reportedId: b.id,
      venueId: TEPLYI,
      reason: "harassment",
      status: "pending",
    });
    expect(await prisma.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(1);
    expect(await everythingSeenBy(b.id)).not.toContain(a.id);
  });

  it("без блокировки — по желанию; неверная причина — 400; чужой — 404; лимит в день", async () => {
    const [a, b, stranger] = [await mkUser(), await mkUser(), await mkUser()];
    await here(a.id);
    await here(b.id);
    await as(a.id);
    expect(await statusOf(report(req({ reason: "nope" }), ctx(b.id)))).toBe(400);
    expect(await statusOf(report(req({ reason: "spam" }), ctx(stranger.id)))).toBe(404);
    for (let i = 0; i < 10; i++)
      expect(await statusOf(report(req({ reason: "spam", block: false }), ctx(b.id)))).toBe(201);
    expect(await statusOf(report(req({ reason: "spam", block: false }), ctx(b.id)))).toBe(429);
    expect(await prisma.block.count({ where: { blockerId: a.id } })).toBe(0);
    // Пожаловавшийся по-прежнему видит человека.
    expect(await everythingSeenBy(a.id)).toContain(b.id);
  });
});

describe("модерация", () => {
  const fileReport = async (reason = "fake_profile") => {
    const [reporter, reported] = [await mkUser("Заявитель"), await mkUser("Нарушитель")];
    await here(reporter.id);
    await here(reported.id);
    await as(reporter.id);
    await report(req({ reason, block: false }), ctx(reported.id));
    const r = await prisma.report.findFirstOrThrow({ where: { reporterId: reporter.id } });
    return { reporter, reported, reportId: r.id };
  };

  it("не-модератору админки как будто нет (404)", async () => {
    const { reported, reportId } = await fileReport();
    await as(reported.id);
    expect(await statusOf(adminReports(new Request("http://x")))).toBe(404);
    expect(await statusOf(resolve(req({ action: "banned" }), ctx(reportId)))).toBe(404);
    expect(await statusOf(adminPhoto(req(), ctx(reported.id)))).toBe(404);
    jar.clear();
    expect(await statusOf(adminReports(new Request("http://x")))).toBe(404);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: reported.id } })).bannedAt,
    ).toBeNull();
  });

  it("модератор видит жалобу без заявителя", async () => {
    const { reporter, reported, reportId } = await fileReport();
    const admin = await mkUser("Модератор", "admin");
    await as(admin.id);
    const text = await (await adminReports(new Request("http://x?status=pending"))).text();
    expect(text).toContain(reportId);
    expect(text).toContain(reported.id);
    expect(text).not.toContain(reporter.id);
    expect(text).not.toContain(reporter.phone);
    expect(text).not.toContain(reported.phone);
    expect(await statusOf(adminPhoto(req(), ctx(reported.id)))).toBe(200);
  });

  it("бан: вход закрыт, сессии и отметка сняты, человека не видно в списках, входящих и чатах", async () => {
    const { reporter, reported, reportId } = await fileReport();
    // До бана: нарушитель написал(а) привет третьему человеку и успел(а) получить чат.
    const c = await mkUser();
    await here(c.id);
    await as(reported.id);
    await hello(req({ isSuper: false, message: "Привет!" }), ctx(c.id));
    await as(c.id);
    expect(await everythingSeenBy(c.id)).toContain(reported.id);
    // Вторая жалоба на того же человека.
    await as(c.id);
    await report(req({ reason: "spam", block: false }), ctx(reported.id));

    const admin = await mkUser("Модератор", "admin");
    await as(admin.id);
    const bus = await listen();
    expect(await statusOf(resolve(req({ action: "banned" }), ctx(reportId)))).toBe(200);
    await bus.stop();
    expect(bus.events).toContainEqual({ type: "logout", userId: reported.id });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: reported.id } });
    expect(u.bannedAt).not.toBeNull();
    expect(await prisma.session.count({ where: { userId: reported.id } })).toBe(0);
    expect(await getPresence(redis, reported.id)).toBeNull();
    // Обе жалобы на него закрыты.
    expect(
      await prisma.report.count({ where: { reportedId: reported.id, status: "pending" } }),
    ).toBe(0);

    for (const viewer of [reporter, c]) {
      await here(viewer.id);
      expect(await everythingSeenBy(viewer.id)).not.toContain(reported.id);
    }
    // Даже если бы отметка осталась — в списке его нет.
    await here(reported.id);
    expect(await everythingSeenBy(c.id)).not.toContain(reported.id);

    // Даже сессия, созданная в обход, не действует; войти заново нельзя.
    await startSession({ userId: reported.id });
    expect(await getSession()).toBeNull();
    jar.clear();
    expect(await statusOf(requestCode(req({ phone: reported.phone })))).toBe(200);
    const res = await verify(req({ phone: reported.phone, code: codes.get(reported.phone) }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "banned" });

    // Повторно ту же жалобу не решить.
    await as(admin.id);
    expect(await statusOf(resolve(req({ action: "dismissed" }), ctx(reportId)))).toBe(404);
  });

  it("снять фото: фото удалено, человек не виден до новой селфи-проверки", async () => {
    const { reporter, reported, reportId } = await fileReport("inappropriate");
    const admin = await mkUser("Модератор", "admin");
    await as(admin.id);
    expect(await statusOf(resolve(req({ action: "photo_removed" }), ctx(reportId)))).toBe(200);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: reported.id } });
    expect(u).toMatchObject({ photo: null, verifiedAt: null, bannedAt: null });
    expect(deletedPhotos).toContain("u/x/photo.webp");
    expect(await getPresence(redis, reported.id)).toBeNull();
    await here(reported.id);
    expect(await everythingSeenBy(reporter.id)).not.toContain(reported.id);
  });

  it("отклонить: закрывается только эта жалоба, человек не затронут", async () => {
    const { reporter, reported, reportId } = await fileReport();
    const admin = await mkUser("Модератор", "admin");
    await as(admin.id);
    expect(await statusOf(resolve(req({ action: "dismissed" }), ctx(reportId)))).toBe(200);
    expect(await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).toMatchObject({
      status: "rejected",
      action: "dismissed",
      resolvedById: admin.id,
    });
    expect(await everythingSeenBy(reporter.id)).toContain(reported.id);
    await as(admin.id);
    const resolved = await (await adminReports(new Request("http://x?status=resolved"))).text();
    expect(resolved).toContain(reportId);
  });
});
