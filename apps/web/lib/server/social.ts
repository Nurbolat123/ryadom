import { Prisma, prisma } from "@ryadom/db";
import { getPresence, publishUserEvent, scheduleNotice } from "@ryadom/presence";
import { ageOn, HelloInputSchema, RULES, todayIn } from "@ryadom/shared";
import type { z } from "zod";
import { rateLimit } from "../rate-limit";
import { redis } from "../redis";
import { track } from "./analytics";
import { canSeePerson } from "./people";

/**
 * Симпатии и приветы.
 * Правило 5: невзаимная симпатия не раскрывает отправителя — получатель узнаёт только
 * «кому-то здесь вы понравились» (уведомление отправляет realtime-сервис с задержкой и при N ≥ 3).
 * Правило 6: от A к B один привет, повторно нельзя. Правило 7: «Не сейчас» отправитель не видит.
 */

/** Пара в базе хранится упорядоченно (CHECK userAId < userBId). */
export const orderedPair = (x: string, y: string) =>
  x < y ? { userAId: x, userBId: y } : { userAId: y, userBId: x };

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const chatBetween = (x: string, y: string) =>
  prisma.chat.findUnique({ where: { userAId_userBId: orderedPair(x, y) }, select: { id: true } });

// ───────────────────────── Симпатия ─────────────────────────

export type SympathyResult =
  | { ok: true; status: "sent" }
  | { ok: true; status: "match"; chatId: string }
  | { ok: false; error: "not_found" | "rate_limited" | "matched" };

export const sendSympathy = async (fromId: string, toId: string): Promise<SympathyResult> => {
  if (fromId === toId) return { ok: false, error: "not_found" };
  const presence = await canSeePerson(fromId, toId);
  if (!presence) return { ok: false, error: "not_found" };

  const existing = await prisma.match.findUnique({
    where: { userAId_userBId: orderedPair(fromId, toId) },
    select: { chat: { select: { id: true } } },
  });
  if (existing?.chat) return { ok: true, status: "match", chatId: existing.chat.id };

  if (!(await rateLimit("sympathy", fromId, RULES.sympathiesPerHour, 3600)).ok)
    return { ok: false, error: "rate_limited" };

  const now = new Date();
  // Живёт до конца визита + 24 часа; при уходе срок сокращается (checkin.closeOpenVisits).
  const expiresAt = new Date(presence.expiresAt + RULES.sympathyTtlAfterVisitSeconds * 1000);
  const before = await prisma.sympathy.findUnique({
    where: { fromUserId_toUserId: { fromUserId: fromId, toUserId: toId } },
    select: { expiresAt: true },
  });
  await prisma.sympathy.upsert({
    where: { fromUserId_toUserId: { fromUserId: fromId, toUserId: toId } },
    create: { fromUserId: fromId, toUserId: toId, venueId: presence.venueId, expiresAt },
    update: { venueId: presence.venueId, expiresAt, noticeSentAt: null },
  });
  const isNew = !before || (before.expiresAt !== null && before.expiresAt <= now);
  if (isNew) await track("sympathy_sent", presence.venueId);

  const reverse = await prisma.sympathy.findFirst({
    where: {
      fromUserId: toId,
      toUserId: fromId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (!reverse) {
    // Отправитель не раскрывается: в очередь уходит только «получатель:заведение».
    await scheduleNotice(redis, toId, presence.venueId);
    return { ok: true, status: "sent" };
  }

  const chatId = await createMatch(fromId, toId, presence.venueId);
  return { ok: true, status: "match", chatId };
};

/** Взаимность: Match + Chat (если чат уже есть после привета — привязываем к нему). Обоим — событие. */
const createMatch = async (x: string, y: string, venueId: string) => {
  const pair = orderedPair(x, y);
  const chatId = await prisma.$transaction(async (tx) => {
    const match = await tx.match.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair, venueId },
      update: {},
    });
    const chat = await tx.chat.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair, matchId: match.id },
      update: { matchId: match.id },
    });
    // Взаимные симпатии больше не нужны: дальше общение в чате.
    await tx.sympathy.deleteMany({
      where: {
        OR: [
          { fromUserId: x, toUserId: y },
          { fromUserId: y, toUserId: x },
        ],
      },
    });
    return chat.id;
  });
  await track("match", venueId);
  await Promise.all([
    publishUserEvent(redis, { type: "match", userId: x, chatId }),
    publishUserEvent(redis, { type: "match", userId: y, chatId }),
  ]);
  return chatId;
};

/** Снять сердечко можно только до взаимности. */
export const removeSympathy = async (fromId: string, toId: string) => {
  const match = await prisma.match.findUnique({
    where: { userAId_userBId: orderedPair(fromId, toId) },
    select: { id: true },
  });
  if (match) return { ok: false as const, error: "matched" as const };
  await prisma.sympathy.deleteMany({ where: { fromUserId: fromId, toUserId: toId } });
  return { ok: true as const };
};

// ───────────────────────── Привет ─────────────────────────

export type HelloInput = z.infer<typeof HelloInputSchema>;
export type HelloResult =
  | { ok: true; helloId: string }
  | {
      ok: false;
      error:
        | "not_found"
        | "already_sent"
        | "chat_exists"
        | "hello_limit"
        | "super_limit"
        | "no_super_hellos";
    };

const startOfLocalDay = (timeZone = "Asia/Almaty") => {
  // Полночь по времени Алматы (UTC+5) как момент в UTC.
  const day = todayIn(timeZone);
  return new Date(`${day}T00:00:00+05:00`);
};

const hasPlus = async (userId: string) => {
  const e = await prisma.entitlement.findUnique({ where: { userId }, select: { plusUntil: true } });
  return !!e?.plusUntil && e.plusUntil > new Date();
};

export const sendHello = async (
  fromId: string,
  toId: string,
  input: HelloInput,
): Promise<HelloResult> => {
  if (fromId === toId) return { ok: false, error: "not_found" };
  const presence = await canSeePerson(fromId, toId);
  if (!presence) return { ok: false, error: "not_found" };

  // Правило 6: один привет от A к B — ни после «Не сейчас», ни за деньги.
  const sent = await prisma.hello.findUnique({
    where: { fromUserId_toUserId: { fromUserId: fromId, toUserId: toId } },
    select: { id: true },
  });
  if (sent) return { ok: false, error: "already_sent" };
  if (await chatBetween(fromId, toId)) return { ok: false, error: "chat_exists" };

  if (input.isSuper) {
    const supersThisVisit = await prisma.hello.count({
      where: {
        fromUserId: fromId,
        isSuper: true,
        createdAt: { gte: new Date(presence.startedAt) },
      },
    });
    if (supersThisVisit >= RULES.superHellosPerVisit) return { ok: false, error: "super_limit" };
  } else {
    const limit = (await hasPlus(fromId)) ? RULES.plusHellosPerDay : RULES.freeHellosPerDay;
    const today = await prisma.hello.count({
      where: { fromUserId: fromId, isSuper: false, createdAt: { gte: startOfLocalDay() } },
    });
    if (today >= limit) return { ok: false, error: "hello_limit" };
  }

  if (input.isSuper) await ensureEntitlement(fromId);
  try {
    const hello = await prisma.$transaction(async (tx) => {
      if (input.isSuper) {
        // Списываем суперпривет атомарно: условие superHellos > 0 в самом UPDATE.
        const spent = await tx.entitlement.updateMany({
          where: { userId: fromId, superHellos: { gt: 0 } },
          data: { superHellos: { decrement: 1 } },
        });
        if (spent.count === 0) throw new NoSuperHellos();
      }
      return tx.hello.create({
        data: {
          fromUserId: fromId,
          toUserId: toId,
          venueId: presence.venueId,
          isSuper: input.isSuper,
          message: input.message,
        },
        select: { id: true },
      });
    });
    await track(input.isSuper ? "super_hello_sent" : "hello_sent", presence.venueId);
    await publishUserEvent(redis, { type: "inbox", userId: toId });
    return { ok: true, helloId: hello.id };
  } catch (e) {
    if (e instanceof NoSuperHellos) return { ok: false, error: "no_super_hellos" };
    if (isUniqueViolation(e)) return { ok: false, error: "already_sent" };
    throw e;
  }
};

class NoSuperHellos extends Error {}

/** Строка покупок пользователя; при создании — 1 бесплатный суперпривет (как при регистрации). */
export const ensureEntitlement = (userId: string) =>
  prisma.entitlement.upsert({
    where: { userId },
    create: { userId, superHellos: RULES.freeSuperHellosOnSignup },
    update: {},
  });

/** Остаток суперприветов. */
export const superHellosLeft = async (userId: string) =>
  (await ensureEntitlement(userId)).superHellos;

/** Ответить на привет: открывается чат, первым сообщением — сам привет. */
export const replyToHello = async (userId: string, helloId: string, message: string) => {
  const hello = await prisma.hello.findUnique({ where: { id: helloId } });
  if (!hello || hello.toUserId !== userId)
    return { ok: false as const, error: "not_found" as const };
  if (await isBlockedBetween(hello.fromUserId, userId))
    return { ok: false as const, error: "not_found" as const };
  if (hello.status === "replied") {
    const chat = await chatBetween(hello.fromUserId, userId);
    if (chat) return { ok: true as const, chatId: chat.id };
  }
  const pair = orderedPair(hello.fromUserId, userId);
  const chatId = await prisma.$transaction(async (tx) => {
    await tx.hello.update({
      where: { id: hello.id },
      data: { status: "replied", answeredAt: new Date() },
    });
    const chat = await tx.chat.upsert({
      where: { userAId_userBId: pair },
      create: { ...pair, helloId: hello.id },
      update: { helloId: hello.id },
    });
    await tx.message.createMany({
      data: [
        {
          chatId: chat.id,
          senderId: hello.fromUserId,
          body: hello.message,
          createdAt: hello.createdAt,
        },
        { chatId: chat.id, senderId: userId, body: message },
      ],
    });
    return chat.id;
  });
  await track("hello_replied", hello.venueId);
  await Promise.all([
    publishUserEvent(redis, { type: "chat", userId: hello.fromUserId, chatId }),
    publishUserEvent(redis, { type: "chat", userId, chatId }),
  ]);
  return { ok: true as const, chatId };
};

/** «Не сейчас»: отправитель об этом не узнаёт (правило 7) — никаких событий ему. */
export const dismissHello = async (userId: string, helloId: string) => {
  const res = await prisma.hello.updateMany({
    where: { id: helloId, toUserId: userId, status: "pending" },
    data: { status: "dismissed", answeredAt: new Date() },
  });
  return res.count > 0;
};

export const isBlockedBetween = async (x: string, y: string) =>
  (await prisma.block.count({
    where: {
      OR: [
        { blockerId: x, blockedId: y },
        { blockerId: y, blockedId: x },
      ],
    },
  })) > 0;

// ───────────────────────── Входящие ─────────────────────────

export type InboxHello = {
  id: string;
  isSuper: boolean;
  message: string;
  createdAt: string;
  from: { id: string; name: string; age: number; photoUrl: string };
};
export type InboxNotice = { id: string; venueName: string; createdAt: string; canLook: boolean };

/** Входящие: суперприветы сверху, затем приветы; анонимные «кому-то здесь вы понравились». */
export const inbox = async (userId: string) => {
  const since = new Date(Date.now() - RULES.sympathyTtlAfterVisitSeconds * 1000);
  const [hellos, notices, presence, blocks] = await Promise.all([
    prisma.hello.findMany({
      where: { toUserId: userId, status: "pending" },
      orderBy: [{ isSuper: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        isSuper: true,
        message: true,
        createdAt: true,
        from: { select: { id: true, displayName: true, birthDate: true, photo: true } },
      },
    }),
    prisma.notice.findMany({
      where: { userId, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, venueId: true, venue: { select: { name: true } } },
    }),
    getPresence(redis, userId),
    prisma.block.findMany({
      where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
      select: { blockerId: true, blockedId: true },
    }),
  ]);
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  const today = todayIn();
  return {
    hellos: hellos
      .filter((h) => !blocked.has(h.from.id))
      .map((h): InboxHello => ({
        id: h.id,
        isSuper: h.isSuper,
        message: h.message,
        createdAt: h.createdAt.toISOString(),
        from: {
          id: h.from.id,
          name: h.from.displayName,
          age: ageOn(h.from.birthDate.toISOString().slice(0, 10), today),
          photoUrl: `/api/people/${h.from.id}/photo`,
        },
      })),
    notices: notices.map((n): InboxNotice => ({
      id: n.id,
      venueName: n.venue.name,
      createdAt: n.createdAt.toISOString(),
      canLook: presence?.venueId === n.venueId,
    })),
  };
};

/** Непрочитанное во входящих — для значка в навигации. */
export const inboxCount = async (userId: string) => {
  const [hellos, notices] = await Promise.all([
    prisma.hello.count({ where: { toUserId: userId, status: "pending" } }),
    prisma.notice.count({ where: { userId, readAt: null } }),
  ]);
  return hellos + notices;
};

export const markNoticesRead = (userId: string) =>
  prisma.notice.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
