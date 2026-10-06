import { prisma } from "@ryadom/db";
import { getPresence, publishPresenceEvent, setOpenToMeet } from "@ryadom/presence";
import { ageOn, presenceKeys, todayIn, type Presence } from "@ryadom/shared";
import { redis } from "../redis";
import { track } from "./analytics";

/**
 * Список людей в заведении. Видят его только те, кто сейчас отмечен в этом заведении (правило 1)
 * и сам открыт к знакомству. В списке — только открытые к знакомству (правило 2),
 * с подтверждённым селфи (правило 10), без заблокированных в обе стороны (правило 9).
 * Ни координат, ни расстояний, ни времени прихода в ответе нет (правило 4).
 */

export type PersonInterest = { id: string; name: string; common: boolean };
export type Person = {
  id: string;
  name: string;
  age: number;
  about: string | null;
  photoUrl: string;
  interests: PersonInterest[];
  /** «У вас общее: …» */
  common: string[];
  /** Ты поставил(а) сердечко (видно только тебе). */
  liked: boolean;
  /** Ты уже отправил(а) привет — повторно нельзя (правило 6). Ответ «Не сейчас» не раскрывается. */
  helloSent: boolean;
  /** Уже есть чат (взаимность или ответ на привет). */
  chatId: string | null;
};

export type PeopleResult =
  { ok: true; open: boolean; people: Person[] } | { ok: false; error: "not_checked_in" };

/** userId открытых к знакомству в заведении, новые первыми (score = окончание присутствия). */
const openIds = async (venueId: string, now = Date.now()) => {
  const key = presenceKeys.venueOpen(venueId);
  await redis.zremrangebyscore(key, "-inf", now);
  return redis.zrevrange(key, 0, -1);
};

const blockedWith = async (viewerId: string, ids: string[]) => {
  if (!ids.length) return new Set<string>();
  const rows = await prisma.block.findMany({
    where: {
      OR: [
        { blockerId: viewerId, blockedId: { in: ids } },
        { blockedId: viewerId, blockerId: { in: ids } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  return new Set(rows.map((r) => (r.blockerId === viewerId ? r.blockedId : r.blockerId)));
};

const loadPeople = async (viewerId: string, ids: string[], locale: "ru" | "kk") => {
  const blocked = await blockedWith(viewerId, ids);
  const visible = ids.filter((id) => id !== viewerId && !blocked.has(id));
  if (!visible.length) return [];
  const now = new Date();
  const [users, mine, liked, hellos, chats] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: { in: visible },
        verifiedAt: { not: null },
        photo: { not: null },
        bannedAt: null,
      },
      select: {
        id: true,
        displayName: true,
        birthDate: true,
        about: true,
        interests: {
          select: {
            interest: { select: { id: true, nameRu: true, nameKk: true, sortOrder: true } },
          },
        },
      },
    }),
    prisma.userInterest.findMany({ where: { userId: viewerId }, select: { interestId: true } }),
    // Только свои исходящие: входящие симпатии никогда не попадают в ответ (правило 5).
    prisma.sympathy.findMany({
      where: {
        fromUserId: viewerId,
        toUserId: { in: visible },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { toUserId: true },
    }),
    prisma.hello.findMany({
      where: { fromUserId: viewerId, toUserId: { in: visible } },
      select: { toUserId: true },
    }),
    prisma.chat.findMany({
      where: {
        OR: [
          { userAId: viewerId, userBId: { in: visible } },
          { userBId: viewerId, userAId: { in: visible } },
        ],
      },
      select: { id: true, userAId: true, userBId: true },
    }),
  ]);
  const likedSet = new Set(liked.map((l) => l.toUserId));
  const helloSet = new Set(hellos.map((h) => h.toUserId));
  const chatWith = new Map(
    chats.map((c) => [c.userAId === viewerId ? c.userBId : c.userAId, c.id]),
  );
  const myInterests = new Set(mine.map((m) => m.interestId));
  const today = todayIn();
  const order = new Map(visible.map((id, i) => [id, i]));

  return users
    .map((u): Person => {
      const interests = u.interests
        .map(({ interest: i }) => ({
          id: i.id,
          name: locale === "kk" ? i.nameKk : i.nameRu,
          common: myInterests.has(i.id),
          sortOrder: i.sortOrder,
        }))
        .sort((a, b) => Number(b.common) - Number(a.common) || a.sortOrder - b.sortOrder)
        .map(({ id, name, common }) => ({ id, name, common }));
      return {
        id: u.id,
        name: u.displayName,
        age: ageOn(u.birthDate.toISOString().slice(0, 10), today),
        about: u.about,
        photoUrl: `/api/people/${u.id}/photo`,
        interests,
        common: interests.filter((i) => i.common).map((i) => i.name),
        liked: likedSet.has(u.id),
        helloSent: helloSet.has(u.id),
        chatId: chatWith.get(u.id) ?? null,
      };
    })
    .sort((a, b) => b.common.length - a.common.length || order.get(a.id)! - order.get(b.id)!);
};

export const listPeople = async (viewerId: string, locale: "ru" | "kk"): Promise<PeopleResult> => {
  const presence = await getPresence(redis, viewerId);
  if (!presence) return { ok: false, error: "not_checked_in" };
  if (!presence.openToMeet) return { ok: true, open: false, people: [] };
  return {
    ok: true,
    open: true,
    people: await loadPeople(viewerId, await openIds(presence.venueId), locale),
  };
};

/** Может ли viewer видеть этого человека прямо сейчас (те же правила, что и для списка). */
export const canSeePerson = async (
  viewerId: string,
  targetId: string,
): Promise<Presence | null> => {
  if (viewerId === targetId) return getPresence(redis, viewerId);
  const [mine, theirs] = await Promise.all([
    getPresence(redis, viewerId),
    getPresence(redis, targetId),
  ]);
  if (!mine?.openToMeet || !theirs?.openToMeet || mine.venueId !== theirs.venueId) return null;
  if ((await blockedWith(viewerId, [targetId])).size) return null;
  return mine;
};

export const personCard = async (viewerId: string, targetId: string, locale: "ru" | "kk") => {
  if (!(await canSeePerson(viewerId, targetId)) || viewerId === targetId) return null;
  const [p] = await loadPeople(viewerId, [targetId], locale);
  return p ?? null;
};

/** «Открыт(а) к знакомству»: включается вручную при каждом визите (правило 2). */
export const toggleOpen = async (userId: string, open: boolean) => {
  const p = await setOpenToMeet(redis, userId, open);
  if (!p) return null;
  await publishPresenceEvent(redis, { type: open ? "open" : "closed", venueId: p.venueId, userId });
  if (open) await track("open_to_meet_on", p.venueId);
  return p;
};
