import { prisma } from "@ryadom/db";
import { countClick, liveOfferWhere } from "@ryadom/places";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Переход по предложению (для отчёта партнёру). Только счётчик за день. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  if (!(await rateLimit("offer-click", clientIp(req), 120, 3600)).ok)
    return new Response(null, { status: 204 });
  const offer = await prisma.offer.findFirst({
    where: { id, ...liveOfferWhere() },
    select: { id: true },
  });
  if (offer) await countClick(prisma, id);
  return new Response(null, { status: 204 });
}
