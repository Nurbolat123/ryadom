import { prisma, type ReportAction } from "@ryadom/db";
import { endPresence, getPresence, publishPresenceEvent, publishUserEvent } from "@ryadom/presence";
import { ReportInputSchema, RULES } from "@ryadom/shared";
import type { z } from "zod";
import { rateLimit } from "../rate-limit";
import { redis } from "../redis";
import { hasConversation } from "./chat";
import { canSeePerson } from "./people";
import { getPhotoStorage } from "./storage";

/**
 * Правило 9: блокировка и жалоба бесплатны и мгновенны.
 * Блокировка навсегда скрывает людей друг от друга везде: список, карточка, фото,
 * входящие, чаты, симпатии, приветы. Заблокированному об этом не сообщается.
 * Ожидающие подарки отменяются с возвратом — на этапе подарков (8).
 */

/** Заблокировать или пожаловаться можно на того, кого видишь сейчас или с кем есть переписка. */
const canAct = async (userId: string, targetId: string) =>
  userId !== targetId &&
  (!!(await canSeePerson(userId, targetId)) || (await hasConversation(userId, targetId)));

export const blockUser = async (blockerId: string, blockedId: string) => {
  if (!(await canAct(blockerId, blockedId))) return false;
  await prisma.$transaction([
    prisma.block.upsert({
      where: { blockerId_blockedId: { blockerId, blockedId } },
      create: { blockerId, blockedId },
      update: {},
    }),
    // Симпатии в обе стороны больше не нужны и не должны стать взаимными.
    prisma.sympathy.deleteMany({
      where: {
        OR: [
          { fromUserId: blockerId, toUserId: blockedId },
          { fromUserId: blockedId, toUserId: blockerId },
        ],
      },
    }),
    // Ожидающие приветы тихо закрываются: отправитель видит то же, что и при «Не сейчас».
    prisma.hello.updateMany({
      where: {
        status: "pending",
        OR: [
          { fromUserId: blockerId, toUserId: blockedId },
          { fromUserId: blockedId, toUserId: blockerId },
        ],
      },
      data: { status: "dismissed", answeredAt: new Date() },
    }),
  ]);
  // Обоим — «обновить всё», без указания, кто кого.
  await Promise.all([
    publishUserEvent(redis, { type: "refresh", userId: blockerId }),
    publishUserEvent(redis, { type: "refresh", userId: blockedId }),
  ]);
  return true;
};

export type ReportInput = z.infer<typeof ReportInputSchema>;

export const reportUser = async (reporterId: string, reportedId: string, input: ReportInput) => {
  if (!(await canAct(reporterId, reportedId)))
    return { ok: false as const, error: "not_found" as const };
  if (!(await rateLimit("report", reporterId, RULES.reportsPerDay, 24 * 3600)).ok)
    return { ok: false as const, error: "rate_limited" as const };
  // Заведение — только если оба сейчас в нём (контекст для модератора), без координат.
  const [mine, theirs] = await Promise.all([
    getPresence(redis, reporterId),
    getPresence(redis, reportedId),
  ]);
  const venueId = mine && theirs && mine.venueId === theirs.venueId ? mine.venueId : null;
  await prisma.report.create({
    data: { reporterId, reportedId, venueId, reason: input.reason, comment: input.comment || null },
  });
  if (input.block) await blockUser(reporterId, reportedId);
  return { ok: true as const };
};

// ───────────────────────── Модерация ─────────────────────────

/** Жалобы для модератора. Кто пожаловался — не показывается (защита заявителя). */
export const listReports = async (status: "pending" | "resolved") => {
  const reports = await prisma.report.findMany({
    where: status === "pending" ? { status: "pending" } : { status: { not: "pending" } },
    orderBy: { createdAt: status === "pending" ? "asc" : "desc" },
    take: 100,
    select: {
      id: true,
      reason: true,
      comment: true,
      status: true,
      action: true,
      createdAt: true,
      resolvedAt: true,
      venue: { select: { name: true } },
      reported: {
        select: {
          id: true,
          displayName: true,
          about: true,
          photo: true,
          bannedAt: true,
          createdAt: true,
          _count: { select: { reportsGot: true } },
        },
      },
    },
  });
  return reports.map((r) => ({
    id: r.id,
    reason: r.reason,
    comment: r.comment,
    status: r.status,
    action: r.action,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    venueName: r.venue?.name ?? null,
    reported: r.reported && {
      id: r.reported.id,
      name: r.reported.displayName,
      about: r.reported.about,
      photoUrl: r.reported.photo ? `/api/admin/users/${r.reported.id}/photo` : null,
      banned: !!r.reported.bannedAt,
      registeredAt: r.reported.createdAt.toISOString(),
      reportsTotal: r.reported._count.reportsGot,
    },
  }));
};

/** Закрыть аккаунт: вход закрыт, отметка снята, сессии и подключения закрыты. */
export const banUser = async (userId: string) => {
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { bannedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  const ended = await endPresence(redis, userId);
  if (ended) await publishPresenceEvent(redis, { type: "left", venueId: ended.venueId, userId });
  await publishUserEvent(redis, { type: "logout", userId });
};

/** Снять фото: человек снова проходит фото и селфи-проверку, а пока его не видно в списках. */
export const removePhoto = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { photo: true } });
  if (user?.photo) await getPhotoStorage().delete(user.photo);
  await prisma.user.update({ where: { id: userId }, data: { photo: null, verifiedAt: null } });
  const ended = await endPresence(redis, userId);
  if (ended) await publishPresenceEvent(redis, { type: "left", venueId: ended.venueId, userId });
};

export const resolveReport = async (adminId: string, reportId: string, action: ReportAction) => {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report || report.status !== "pending") return false;
  if (action !== "dismissed" && report.reportedId) {
    if (action === "banned") await banUser(report.reportedId);
    else await removePhoto(report.reportedId);
  }
  // Блокировка и снятие фото закрывают все открытые жалобы на этого человека.
  await prisma.report.updateMany({
    where:
      action === "dismissed" || !report.reportedId
        ? { id: reportId }
        : { reportedId: report.reportedId, status: "pending" },
    data: {
      status: action === "dismissed" ? "rejected" : "approved",
      action,
      resolvedAt: new Date(),
      resolvedById: adminId,
    },
  });
  return true;
};
