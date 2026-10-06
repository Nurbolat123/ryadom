import { prisma } from "@ryadom/db";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { inboxCount } from "@/lib/server/social";

export const dynamic = "force-dynamic";

/** Счётчики для навигации: новые во входящих и непрочитанные сообщения. */
export async function GET() {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const userId = session.user.id;
  const [inbox, chats] = await Promise.all([
    inboxCount(userId),
    prisma.message.count({
      where: {
        readAt: null,
        senderId: { not: userId },
        chat: { OR: [{ userAId: userId }, { userBId: userId }] },
      },
    }),
  ]);
  return Response.json({ inbox, chats });
}
