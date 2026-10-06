import { prisma } from "@ryadom/db";
import { getAdmin } from "@/lib/server/admin";
import { fail } from "@/lib/server/http";
import { getPhotoStorage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Фото человека, на которого пожаловались, — только модератору. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getAdmin())) return fail(404, "not_found");
  const user = await prisma.user.findUnique({
    where: { id: (await params).id },
    select: { photo: true },
  });
  const data = user?.photo ? await getPhotoStorage().get(user.photo) : null;
  if (!data) return fail(404, "not_found");
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "image/webp", "cache-control": "private, no-store" },
  });
}
