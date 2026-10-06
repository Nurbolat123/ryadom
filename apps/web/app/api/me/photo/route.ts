import { randomUUID } from "node:crypto";
import { prisma } from "@ryadom/db";
import { fail } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from "@/lib/server/photo";
import { getSession } from "@/lib/server/session";
import { getPhotoStorage } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/** Загрузить фото профиля: сжатие и удаление EXIF (в том числе GPS) перед сохранением. */
export async function PUT(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof Blob)) return fail(400, "no_photo");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "too_large");

  let webp: Buffer;
  try {
    webp = await processPhoto(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof PhotoError) return fail(400, e.code);
    throw e;
  }

  const storage = getPhotoStorage();
  const key = `u/${session.user.id}/${randomUUID()}.webp`;
  await storage.put(key, webp, "image/webp");
  const old = session.user.photo;
  // Новое фото — повторная селфи-проверка (иначе можно подменить фото после верификации).
  await prisma.user.update({
    where: { id: session.user.id },
    data: { photo: key, verifiedAt: null },
  });
  if (old) await storage.delete(old);

  return Response.json({ ok: true });
}

/** Своё фото (чужие фото откроются на этапе 5 — только людям в том же заведении). */
export async function GET() {
  const session = await getSession();
  if (!session?.user?.photo) return fail(404, "no_photo");
  const data = await getPhotoStorage().get(session.user.photo);
  if (!data) return fail(404, "no_photo");
  return new Response(new Uint8Array(data), {
    headers: { "content-type": "image/webp", "cache-control": "private, no-store" },
  });
}
