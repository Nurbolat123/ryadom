import { prisma, type Session, type User } from "@ryadom/db";
import { cookies } from "next/headers";
import { randomToken, sha256 } from "./hash";

export const SESSION_COOKIE = "ryadom_session";
/** Сессия пользователя живёт 90 дней, сессия незавершённой регистрации — сутки. */
const USER_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const SIGNUP_TTL_MS = 24 * 60 * 60 * 1000;

export type CurrentSession = Session & { user: User | null };

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  expires,
});

/** Создать сессию после подтверждения кода и поставить cookie. */
export const startSession = async (owner: { userId: string } | { phone: string }) => {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + ("userId" in owner ? USER_TTL_MS : SIGNUP_TTL_MS));
  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      expiresAt,
      ...("userId" in owner ? { userId: owner.userId } : { phone: owner.phone }),
    },
  });
  (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
};

/** Текущая сессия по cookie (или null). Истёкшие удаляются. */
export const getSession = async (): Promise<CurrentSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt < new Date() || session.user?.bannedAt) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
};

/** Регистрация завершила создание пользователя: сессия становится пользовательской. */
export const attachUserToSession = async (sessionId: string, userId: string) => {
  const expiresAt = new Date(Date.now() + USER_TTL_MS);
  const s = await prisma.session.update({
    where: { id: sessionId },
    data: { userId, phone: null, expiresAt },
    select: { tokenHash: true },
  });
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token && sha256(token) === s.tokenHash) {
    (await cookies()).set(SESSION_COOKIE, token, cookieOptions(expiresAt));
  }
};

export const endSession = async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  store.delete(SESSION_COOKIE);
};
