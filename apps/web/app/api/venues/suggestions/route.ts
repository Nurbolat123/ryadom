import { prisma } from "@ryadom/db";
import { createVenueSuggestion, VenueSuggestionInputSchema } from "@ryadom/venues";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Не больше 5 предложений в сутки с одного адреса. */
const LIMIT = { count: 5, windowSec: 24 * 60 * 60 };

/**
 * «Нет моего заведения». Принимает только название, город, категорию, адрес и комментарий;
 * координаты пользователя не принимаются и не сохраняются (правило 4).
 * Вход появится на этапе 3 — тогда сюда добавится userId.
 */
export async function POST(req: Request) {
  const limited = await rateLimit("venue-suggest", clientIp(req), LIMIT.count, LIMIT.windowSec);
  if (!limited.ok) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSec) } },
    );
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = VenueSuggestionInputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "bad_request", fields: Object.keys(parsed.error.flatten().fieldErrors) },
      { status: 400 },
    );
  }

  const res = await createVenueSuggestion(prisma, parsed.data, null);
  return Response.json({ id: res.id, status: "pending" }, { status: res.duplicate ? 200 : 201 });
}
