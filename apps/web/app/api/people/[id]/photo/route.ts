import { prisma } from "@ryadom/db";
import { fail } from "@/lib/server/http";
import { hasConversation } from "@/lib/server/chat";
import { canSeePerson } from "@/lib/server/people";
import { isBlockedBetween } from "@/lib/server/social";
import { getSession } from "@/lib/server/session";
import { getPhotoStorage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Фото человека: в заведении — по правилам списка; иначе — только тем, с кем есть переписка. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const { id } = await params;
  // В заведении — по правилам списка; вне его — только собеседник по чату или автор привета тебе.
  const viewer = session.user.id;
  const allowed =
    (await canSeePerson(viewer, id)) ||
    (id !== viewer && (await hasConversation(viewer, id)) && !(await isBlockedBetween(viewer, id)));
  if (!allowed) return fail(404, "not_found");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { photo: true, verifiedAt: true },
  });
  if (!user?.photo || (!user.verifiedAt && id !== session.user.id)) return fail(404, "not_found");
  const data = await getPhotoStorage().get(user.photo);
  if (!data) return fail(404, "not_found");
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "image/webp", "cache-control": "private, no-store" },
  });
}
