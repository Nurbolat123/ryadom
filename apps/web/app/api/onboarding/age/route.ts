import { BirthDateSchema, isAdult } from "@ryadom/shared";
import { blockUnderage, isUnderageBlocked } from "@/lib/server/age-block";
import { fail, readJson } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/**
 * Проверка 18+ до ввода имени и фото (правило 10).
 * Младше 18 — регистрация с этого номера закрыта на 30 дней.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.phone) return fail(401, "no_signup_session");
  if (await isUnderageBlocked(session.phone)) return fail(403, "underage");

  const body = (await readJson(req)) as { birthDate?: unknown } | null;
  const birthDate = BirthDateSchema.safeParse(body?.birthDate);
  if (!birthDate.success) return fail(400, "invalid_birth_date");

  if (!isAdult(birthDate.data)) {
    await blockUnderage(session.phone);
    return fail(403, "underage");
  }
  return Response.json({ ok: true });
}
