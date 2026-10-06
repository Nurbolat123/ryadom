import { prisma } from "@ryadom/db";
import { publishUserEvent } from "@ryadom/presence";
import { RULES } from "@ryadom/shared";
import { rateLimit } from "../rate-limit";
import { redis } from "../redis";
import { isBlockedBetween } from "./social";

/**
 * Чаты открываются после взаимной симпатии или ответа на привет.
 * Правило 13: телефон собеседника открывается, только когда оба нажали «Обменяться контактами»;
 * пока нажал один — второй об этом не узнаёт (ни в ответах API, ни в событиях).
 * Тексты сообщений не пишутся в логи.
 */

type ChatRow = { id: string; userAId: string; userBId: string };

/** Чат, если пользователь в нём участвует и никто никого не заблокировал. */
const chatFor = async (
  userId: string,
  chatId: string,
): Promise<(ChatRow & { otherId: string }) | null> => {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, userAId: true, userBId: true },
  });
  if (!chat || (chat.userAId !== userId && chat.userBId !== userId)) return null;
  const otherId = chat.userAId === userId ? chat.userBId : chat.userAId;
  if (await isBlockedBetween(userId, otherId)) return null;
  const other = await prisma.user.findUnique({
    where: { id: otherId },
    select: { bannedAt: true },
  });
  if (!other || other.bannedAt) return null;
  return { ...chat, otherId };
};

export type ChatSummary = {
  id: string;
  other: { id: string; name: string; photoUrl: string };
  lastMessage: { body: string; mine: boolean; createdAt: string } | null;
  unread: number;
  fromMatch: boolean;
};

export const listChats = async (userId: string): Promise<ChatSummary[]> => {
  const chats = await prisma.chat.findMany({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    select: {
      id: true,
      matchId: true,
      createdAt: true,
      userA: { select: { id: true, displayName: true, bannedAt: true } },
      userB: { select: { id: true, displayName: true, bannedAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const blocks = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const blocked = new Set(blocks.map((b) => (b.blockerId === userId ? b.blockedId : b.blockerId)));
  const unread = await prisma.message.groupBy({
    by: ["chatId"],
    where: { chatId: { in: chats.map((c) => c.id) }, senderId: { not: userId }, readAt: null },
    _count: true,
  });
  const unreadBy = new Map(unread.map((u) => [u.chatId, u._count]));
  return chats
    .map((c) => {
      const other = c.userA.id === userId ? c.userB : c.userA;
      const last = c.messages[0];
      return {
        sortAt: (last?.createdAt ?? c.createdAt).getTime(),
        summary: {
          id: c.id,
          other: {
            id: other.id,
            name: other.displayName,
            photoUrl: `/api/people/${other.id}/photo`,
          },
          lastMessage: last
            ? {
                body: last.body,
                mine: last.senderId === userId,
                createdAt: last.createdAt.toISOString(),
              }
            : null,
          unread: unreadBy.get(c.id) ?? 0,
          fromMatch: !!c.matchId,
        },
        otherId: other.id,
        hidden: !!other.bannedAt,
      };
    })
    .filter((c) => !blocked.has(c.otherId) && !c.hidden)
    .sort((a, b) => b.sortAt - a.sortAt)
    .map((c) => c.summary);
};

export type ChatView = {
  id: string;
  other: { id: string; name: string; photoUrl: string };
  fromMatch: boolean;
  messages: { id: string; body: string; mine: boolean; createdAt: string }[];
  contacts: { iConfirmed: boolean; phone: string | null };
};

export const getChat = async (userId: string, chatId: string): Promise<ChatView | null> => {
  const chat = await chatFor(userId, chatId);
  if (!chat) return null;
  const [other, full, messages, exchanges] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: chat.otherId },
      select: { id: true, displayName: true, phone: true },
    }),
    prisma.chat.findUniqueOrThrow({ where: { id: chatId }, select: { matchId: true } }),
    prisma.message.findMany({ where: { chatId }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.contactExchange.findMany({ where: { chatId }, select: { userId: true } }),
  ]);
  await prisma.message.updateMany({
    where: { chatId, senderId: chat.otherId, readAt: null },
    data: { readAt: new Date() },
  });
  const iConfirmed = exchanges.some((e) => e.userId === userId);
  const bothConfirmed = iConfirmed && exchanges.some((e) => e.userId === chat.otherId);
  return {
    id: chatId,
    other: { id: other.id, name: other.displayName, photoUrl: `/api/people/${other.id}/photo` },
    fromMatch: !!full.matchId,
    messages: messages.reverse().map((m) => ({
      id: m.id,
      body: m.body,
      mine: m.senderId === userId,
      createdAt: m.createdAt.toISOString(),
    })),
    // Телефон — только при подтверждении обоими (правило 13).
    contacts: { iConfirmed, phone: bothConfirmed ? other.phone : null },
  };
};

export const sendMessage = async (userId: string, chatId: string, body: string) => {
  const chat = await chatFor(userId, chatId);
  if (!chat) return { ok: false as const, error: "not_found" as const };
  if (!(await rateLimit("message", userId, RULES.messagesPerMinute, 60)).ok)
    return { ok: false as const, error: "rate_limited" as const };
  const m = await prisma.message.create({ data: { chatId, senderId: userId, body } });
  await Promise.all([
    publishUserEvent(redis, { type: "chat", userId: chat.otherId, chatId }),
    publishUserEvent(redis, { type: "chat", userId, chatId }),
  ]);
  return {
    ok: true as const,
    message: { id: m.id, body: m.body, mine: true, createdAt: m.createdAt.toISOString() },
  };
};

/** «Обменяться контактами». Пока нажал только один — собеседнику ничего не уходит. */
export const confirmContacts = async (userId: string, chatId: string) => {
  const chat = await chatFor(userId, chatId);
  if (!chat) return null;
  await prisma.contactExchange.upsert({
    where: { chatId_userId: { chatId, userId } },
    create: { chatId, userId },
    update: {},
  });
  const both = (await prisma.contactExchange.count({ where: { chatId } })) === 2;
  if (both) await publishUserEvent(redis, { type: "chat", userId: chat.otherId, chatId });
  return getChat(userId, chatId);
};

/** Есть ли у пары чат или привет от target к viewer — тогда можно показать фото вне заведения. */
export const hasConversation = async (viewerId: string, targetId: string) => {
  const [a, b] = viewerId < targetId ? [viewerId, targetId] : [targetId, viewerId];
  const [chat, hello, gift, target] = await Promise.all([
    prisma.chat.count({ where: { userAId: a, userBId: b } }),
    prisma.hello.count({ where: { fromUserId: targetId, toUserId: viewerId } }),
    prisma.gift.count({
      where: {
        fromUserId: targetId,
        toUserId: viewerId,
        status: { in: ["pending", "accepted", "redeemed"] },
      },
    }),
    prisma.user.findUnique({ where: { id: targetId }, select: { bannedAt: true } }),
  ]);
  return !!target && !target.bannedAt && chat + hello + gift > 0;
};
