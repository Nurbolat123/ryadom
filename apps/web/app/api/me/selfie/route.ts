import { prisma } from "@ryadom/db";
import { track } from "@/lib/server/analytics";
import { fail } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, PhotoError, processPhoto } from "@/lib/server/photo";
import { getSession } from "@/lib/server/session";
import { getPhotoStorage } from "@/lib/server/storage";
import { getVerificationProvider } from "@/lib/server/verification";

export const dynamic = "force-dynamic";

/**
 * Селфи-проверка. Селфи передаётся провайдеру проверки и нигде не сохраняется.
 * Без подтверждённого селфи человек не показывается в списках (правило 10).
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  if (!session.user.photo) return fail(409, "no_photo");

  const form = await req.formData().catch(() => null);
  const file = form?.get("selfie");
  if (!(file instanceof Blob)) return fail(400, "no_photo");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "too_large");

  let selfie: Buffer;
  try {
    selfie = await processPhoto(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof PhotoError) return fail(400, e.code);
    throw e;
  }
  const profilePhoto = await getPhotoStorage().get(session.user.photo);
  if (!profilePhoto) return fail(409, "no_photo");

  const verdict = await getVerificationProvider().verifySelfie({ selfie, profilePhoto });
  if (verdict !== "approved") return fail(422, "selfie_rejected");

  await prisma.user.update({ where: { id: session.user.id }, data: { verifiedAt: new Date() } });
  // Воронка: регистрация завершена (обезличенно, без заведения).
  if (!session.user.verifiedAt) await track("registered", null);
  return Response.json({ ok: true, next: "/home" });
}
