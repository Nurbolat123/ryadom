import type { PrismaClient } from "@ryadom/db";
import { countOpenToMeet, getPresence, scheduleNotice, takeDueNotices } from "@ryadom/presence";
import { RULES } from "@ryadom/shared";
import type { Redis } from "ioredis";

/**
 * Анонимное уведомление о симпатии (правило 5).
 * - Отправляется только получателю, пока он в этом заведении, и только если там сейчас
 *   открыты к знакомству не меньше 3 человек. Иначе откладывается ещё на 1–10 минут.
 * - Несколько симпатий в одном заведении → одно уведомление.
 * - В уведомлении и в событии сокета нет ничего об отправителе.
 */
export const processNotices = async ({
  db,
  redis,
  notify,
  now = Date.now(),
}: {
  db: PrismaClient;
  redis: Redis;
  /** Сигнал «входящие изменились» в комнату пользователя. */
  notify: (userId: string) => void;
  now?: number;
}) => {
  let sent = 0;
  for (const { toUserId, venueId } of await takeDueNotices(redis, now)) {
    const presence = await getPresence(redis, toUserId, now);
    // Получатель ушёл — «здесь» уже неправда; симпатия остаётся и может стать взаимной.
    if (presence?.venueId !== venueId) continue;

    const blocks = await db.block.findMany({
      where: { OR: [{ blockerId: toUserId }, { blockedId: toUserId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = blocks.map((b) => (b.blockerId === toUserId ? b.blockedId : b.blockerId));
    const pending = await db.sympathy.findMany({
      where: {
        toUserId,
        venueId,
        noticeSentAt: null,
        fromUserId: { notIn: blocked },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }],
      },
      select: { id: true },
    });
    if (!pending.length) continue;

    if ((await countOpenToMeet(redis, venueId, now)) < RULES.minOpenPeopleForAnonymousNotice) {
      await scheduleNotice(redis, toUserId, venueId, now);
      continue;
    }

    await db.$transaction([
      db.notice.create({ data: { userId: toUserId, venueId, kind: "sympathy_anonymous" } }),
      db.sympathy.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { noticeSentAt: new Date(now) },
      }),
    ]);
    notify(toUserId);
    sent++;
  }
  return sent;
};

/** Симпатии живут 24 часа после окончания визита — потом удаляются. */
export const deleteExpiredSympathies = (db: PrismaClient, now = Date.now()) =>
  db.sympathy.deleteMany({ where: { expiresAt: { lt: new Date(now) } } });
