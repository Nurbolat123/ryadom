import { prisma } from "@ryadom/db";
import { fail } from "@/lib/server/http";
import { canSeePerson } from "@/lib/server/people";
import { getSession } from "@/lib/server/session";
import { getPhotoStorage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Фото человека — по тем же правилам, что и список (только внутри заведения). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const { id } = await params;
  if (!(await canSeePerson(session.user.id, id))) return fail(404, "not_found");
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
