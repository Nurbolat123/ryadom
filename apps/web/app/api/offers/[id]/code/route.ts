import { prisma } from "@ryadom/db";
import { issueOfferCode } from "@ryadom/places";
import { RULES } from "@ryadom/shared";
import { offerAudience } from "@/lib/server/ads";
import { fail } from "@/lib/server/http";
import { getSession } from "@/lib/server/session";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Код скидки для стойки. Нужен вход (защита от накрутки), но сам код с человеком не связан:
 * в базе только предложение, код и срок (правило 14).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  if (!(await rateLimit("offer-code", session.user.id, RULES.offerCodesPerDay, 86_400)).ok)
    return fail(429, "rate_limited");
  const code = await issueOfferCode(prisma, (await params).id, new Date(), await offerAudience());
  if (!code) return fail(404, "not_found");
  return Response.json(
    { code: code.code, expiresAt: code.expiresAt.toISOString() },
    { status: 201 },
  );
}
