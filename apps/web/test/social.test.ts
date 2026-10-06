import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jar } from "./cookies-mock";

vi.mock("next-intl/server", () => ({ getLocale: async () => "ru" }));

const { prisma } = await import("@ryadom/db");
const { endPresence, NOTICE_QUEUE_KEY, setOpenToMeet, startPresence, USER_CHANNEL } =
  await import("@ryadom/presence");
const sympathy = await import("@/app/api/people/[id]/sympathy/route");
const { POST: hello } = await import("@/app/api/people/[id]/hello/route");
const { GET: people } = await import("@/app/api/here/people/route");
const { GET: card } = await import("@/app/api/people/[id]/route");
const { GET: photo } = await import("@/app/api/people/[id]/photo/route");
const { GET: inbox } = await import("@/app/api/inbox/route");
const { GET: badges } = await import("@/app/api/badges/route");
const { POST: reply } = await import("@/app/api/hellos/[id]/reply/route");
const { POST: dismiss } = await import("@/app/api/hellos/[id]/dismiss/route");
const { GET: chats } = await import("@/app/api/chats/route");
const { GET: chat } = await import("@/app/api/chats/[id]/route");
const { POST: send } = await import("@/app/api/chats/[id]/messages/route");
const { POST: contacts } = await import("@/app/api/chats/[id]/contacts/route");
const { DELETE: leave } = await import("@/app/api/checkin/route");
const { redis } = await import("@/lib/redis");
const { startSession } = await import("@/lib/server/session");
const { setPhotoStorage } = await import("@/lib/server/storage");

setPhotoStorage({
  put: async () => undefined,
  get: async () => Buffer.from("webp"),
  delete: async () => undefined,
});

const TEPLYI = (await prisma.venue.findUniqueOrThrow({ where: { slug: "teplyi-ugol" } })).id;
const POLKA = (await prisma.venue.findUniqueOrThrow({ where: { slug: "bar-polka" } })).id;

const users: string[] = [];
const mkUser = async (name = "Тест") => {
  const u = await prisma.user.create({
    data: {
      phone: `+7708${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      birthDate: new Date("1995-01-01"),
      gender: "female",
      displayName: name,
      photo: "u/x/photo.webp",
      verifiedAt: new Date(),
    },
  });
  users.push(u.id);
  return u;
};
const as = async (userId: string) => {
  jar.clear();
  await startSession({ userId });
};
const here = async (user: string | { id: string }, venueId = TEPLYI) => {
  const userId = typeof user === "string" ? user : user.id;
  await startPresence(redis, userId, venueId, `visit-${userId}`);
  await setOpenToMeet(redis, userId, true);
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (body?: unknown) =>
  new Request("http://x", {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const like = async (from: string, to: string) => {
  await as(from);
  return sympathy.POST(req(), ctx(to));
};
const sayHello = async (
  from: string,
  to: string,
  body: unknown = { isSuper: false, message: "Привет!" },
) => {
  await as(from);
  return hello(req(body), ctx(to));
};

/** Все ответы API, которые видит получатель — в них не должно быть отправителя симпатии. */
const everythingSeenBy = async (userId: string, others: string[]) => {
  await as(userId);
  const parts = [
    await (await people()).text(),
    await (await inbox()).text(),
    await (await badges()).text(),
    await (await chats()).text(),
  ];
  for (const o of others) parts.push(await (await card(req(), ctx(o))).text());
  return parts.join("\n");
};

/** Подслушать шину личных событий. */
const listen = async () => {
  const sub = redis.duplicate();
  const events: string[] = [];
  await sub.subscribe(USER_CHANNEL);
  sub.on("message", (_c, m) => events.push(m));
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
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
  redis.disconnect();
});

describe("симпатия (правило 5)", () => {
  it("только внутри заведения и только тем, кого видишь", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(b);
    expect((await like(a.id, b.id)).status).toBe(404); // a не отмечен(а)
    await here(a, POLKA);
    expect((await like(a.id, b.id)).status).toBe(404); // другое заведение
    await here(a);
    await setOpenToMeet(redis, b.id, false);
    expect((await like(a.id, b.id)).status).toBe(404); // b закрыт(а)
  });

  it("невзаимная: получатель нигде не видит отправителя; уведомление — в очередь без имени", async () => {
    const [a, b] = [await mkUser("Секрет"), await mkUser()];
    await here(a);
    await here(b);
    const bus = await listen();
    const res = await like(a.id, b.id);
    expect(await res.json()).toEqual({ status: "sent" });
    await bus.stop();

    // Ни одного события сразу (уведомление уходит позже, через realtime).
    expect(bus.events).toEqual([]);
    // В очереди только «получатель:заведение».
    expect(await redis.zrange(NOTICE_QUEUE_KEY, 0, -1)).toEqual([`${b.id}:${TEPLYI}`]);

    const seen = await everythingSeenBy(b.id, [a.id]);
    expect(seen).not.toMatch(/"liked":true/);
    // Карточка a у b есть (оба открыты), но без признака «ты понравился(лась)».
    expect(seen).not.toMatch(/likedMe|likesYou|sympath/i);
    // Аналитика обезличена.
    const events = await prisma.analyticsEvent.findMany({
      where: { type: "sympathy_sent" },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(Object.keys(events[0]!).sort()).toEqual(["createdAt", "day", "id", "type", "venueId"]);
  });

  it("отправитель видит своё сердечко и может снять его до взаимности", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    await like(a.id, b.id);
    await as(a.id);
    const list = (await (await people()).json()) as { people: { id: string; liked: boolean }[] };
    expect(list.people.find((p) => p.id === b.id)?.liked).toBe(true);
    expect((await sympathy.DELETE(req(), ctx(b.id))).status).toBe(200);
    expect(await prisma.sympathy.count({ where: { fromUserId: a.id } })).toBe(0);
  });

  it("взаимность: обоим событие с чатом, имя раскрывается, снять сердечко уже нельзя", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    await like(a.id, b.id);
    const bus = await listen();
    const res = await like(b.id, a.id);
    const body = (await res.json()) as { status: string; chatId: string };
    await bus.stop();
    expect(body.status).toBe("match");
    const events = bus.events.map((e) => JSON.parse(e));
    expect(events).toEqual(
      expect.arrayContaining([
        { type: "match", userId: a.id, chatId: body.chatId },
        { type: "match", userId: b.id, chatId: body.chatId },
      ]),
    );
    await as(a.id);
    const list = (await (await chats()).json()) as {
      chats: { id: string; other: { id: string } }[];
    };
    expect(list.chats).toEqual([
      expect.objectContaining({ id: body.chatId, other: expect.objectContaining({ id: b.id }) }),
    ]);
    await as(b.id);
    expect((await sympathy.DELETE(req(), ctx(a.id))).status).toBe(409);
  });

  it("уход из заведения: симпатия живёт ещё 24 часа", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    await as(a.id);
    // Визит для a, чтобы было что закрывать.
    await prisma.visit.create({ data: { userId: a.id, venueId: TEPLYI, startedAt: new Date() } });
    await like(a.id, b.id);
    await as(a.id);
    await leave();
    const s = await prisma.sympathy.findFirstOrThrow({ where: { fromUserId: a.id } });
    const hours = (s.expiresAt!.getTime() - Date.now()) / 3600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThanOrEqual(24);
  });
});

describe("привет (правила 6 и 7)", () => {
  it("один привет: второй нельзя ни после «Не сейчас», ни суперприветом", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    expect((await sayHello(a.id, b.id)).status).toBe(201);
    expect((await sayHello(a.id, b.id)).status).toBe(409);

    await as(b.id);
    const { hellos } = (await (await inbox()).json()) as { hellos: { id: string }[] };
    expect((await dismiss(req(), ctx(hellos[0]!.id))).status).toBe(200);
    expect((await sayHello(a.id, b.id)).status).toBe(409);
    expect((await sayHello(a.id, b.id, { isSuper: true, message: "Очень!" })).status).toBe(409);
  });

  it("«Не сейчас» невидимо: отправитель видит то же, что и до ответа, и не получает событий", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a);
    await here(b);
    await sayHello(a.id, b.id);
    await as(a.id);
    const before = await (await card(req(), ctx(b.id))).text();
    await as(b.id);
    const { hellos } = (await (await inbox()).json()) as { hellos: { id: string }[] };
    const bus = await listen();
    await as(b.id);
    await dismiss(req(), ctx(hellos[0]!.id));
    await bus.stop();
    expect(bus.events.filter((e) => e.includes(a.id))).toEqual([]);
    await as(a.id);
    expect(await (await card(req(), ctx(b.id))).text()).toBe(before);
    expect(before).not.toMatch(/dismiss|declin|reject|отказ/i);
  });

  it("суперприветы сверху; длина 100/200; бесплатный суперпривет один", async () => {
    const [a, c, b] = [await mkUser("Обычный"), await mkUser("Супер"), await mkUser()];
    for (const u of [a, c, b]) await here(u.id);
    expect((await sayHello(a.id, b.id, { isSuper: false, message: "x".repeat(101) })).status).toBe(
      400,
    );
    expect((await sayHello(a.id, b.id)).status).toBe(201);
    expect((await sayHello(c.id, b.id, { isSuper: true, message: "x".repeat(200) })).status).toBe(
      201,
    );
    await as(b.id);
    const box = (await (await inbox()).json()) as {
      hellos: { isSuper: boolean; from: { id: string } }[];
    };
    expect(box.hellos.map((h) => [h.from.id, h.isSuper])).toEqual([
      [c.id, true],
      [a.id, false],
    ]);
    // Второй суперпривет — уже не на что.
    const d = await mkUser();
    await here(d.id);
    expect((await sayHello(c.id, d.id, { isSuper: true, message: "Ещё" })).status).toBe(402);
  });

  it("не больше 5 обычных приветов в день без «Плюс»", async () => {
    const a = await mkUser();
    await here(a.id);
    for (let i = 0; i < 5; i++) {
      const t = await mkUser();
      await here(t.id);
      expect((await sayHello(a.id, t.id)).status).toBe(201);
    }
    const sixth = await mkUser();
    await here(sixth.id);
    expect((await sayHello(a.id, sixth.id)).status).toBe(429);
  });

  it("ответ открывает чат с приветом первым сообщением; фото доступно вне заведения", async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a.id);
    await here(b.id);
    await sayHello(a.id, b.id, { isSuper: false, message: "Ты тоже любишь кофе?" });
    await as(b.id);
    const { hellos } = (await (await inbox()).json()) as { hellos: { id: string }[] };
    const res = await reply(req({ message: "Да!" }), ctx(hellos[0]!.id));
    const { chatId } = (await res.json()) as { chatId: string };
    await endPresence(redis, a.id);
    await endPresence(redis, b.id);
    await as(a.id);
    const view = (await (await chat(req(), ctx(chatId))).json()) as {
      chat: { messages: { body: string; mine: boolean }[] };
    };
    expect(view.chat.messages.map((m) => [m.body, m.mine])).toEqual([
      ["Ты тоже любишь кофе?", true],
      ["Да!", false],
    ]);
    expect((await photo(req(), ctx(b.id))).status).toBe(200);
    // Чужой человек без переписки — нет.
    const stranger = await mkUser();
    expect((await photo(req(), ctx(stranger.id))).status).toBe(404);
  });
});

describe("чат и контакты (правило 13)", () => {
  const matched = async () => {
    const [a, b] = [await mkUser(), await mkUser()];
    await here(a.id);
    await here(b.id);
    await like(a.id, b.id);
    const { chatId } = (await (await like(b.id, a.id)).json()) as { chatId: string };
    return { a, b, chatId };
  };

  it("в чат может писать и читать только участник", async () => {
    const { a, chatId } = await matched();
    const c = await mkUser();
    await as(c.id);
    expect((await chat(req(), ctx(chatId))).status).toBe(404);
    expect((await send(req({ body: "Привет" }), ctx(chatId))).status).toBe(404);
    await as(a.id);
    expect((await send(req({ body: "  " }), ctx(chatId))).status).toBe(400);
    expect((await send(req({ body: "Подойду?" }), ctx(chatId))).status).toBe(201);
  });

  it("номер открывается только когда нажали оба; один нажал — второй ничего не узнаёт", async () => {
    const { a, b, chatId } = await matched();
    await as(b.id);
    const before = await (await chat(req(), ctx(chatId))).text();

    const bus = await listen();
    await as(a.id);
    const mine = (await (await contacts(req(), ctx(chatId))).json()) as {
      chat: { contacts: { iConfirmed: boolean; phone: string | null } };
    };
    await bus.stop();
    expect(mine.chat.contacts).toEqual({ iConfirmed: true, phone: null });
    expect(bus.events.filter((e) => e.includes(b.id))).toEqual([]);
    await as(b.id);
    expect(await (await chat(req(), ctx(chatId))).text()).toBe(before);
    expect(before).not.toContain(a.phone);

    const both = (await (await contacts(req(), ctx(chatId))).json()) as {
      chat: { contacts: { phone: string | null } };
    };
    expect(both.chat.contacts.phone).toBe(a.phone);
    await as(a.id);
    const forA = (await (await chat(req(), ctx(chatId))).json()) as {
      chat: { contacts: { phone: string | null } };
    };
    expect(forA.chat.contacts.phone).toBe(b.phone);
  });

  it("заблокированный не видит чат", async () => {
    const { a, b, chatId } = await matched();
    await prisma.block.create({ data: { blockerId: b.id, blockedId: a.id } });
    await as(a.id);
    expect((await chat(req(), ctx(chatId))).status).toBe(404);
    expect(((await (await chats()).json()) as { chats: unknown[] }).chats).toEqual([]);
  });
});
