import { prisma } from "@ryadom/db";
import { getPaymentProvider } from "@ryadom/billing";
import { z } from "zod";
import { fail, readJson } from "@/lib/server/http";
import { completePayment, failPayment } from "@/lib/server/payments";
import { getSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

/** Тестовая оплата (только разработка и заглушка): «Оплатить» или «Отменить». */
export async function POST(req: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  if (process.env.NODE_ENV === "production" || getPaymentProvider().name !== "stub")
    return fail(404, "not_found");
  const session = await getSession();
  if (!session?.user) return fail(401, "unauthorized");
  const body = z.object({ action: z.enum(["pay", "cancel"]) }).safeParse(await readJson(req));
  if (!body.success) return fail(400, "invalid_request");
  const { paymentId } = await params;
  const p = await prisma.purchase.findFirst({ where: { paymentId, userId: session.user.id } });
  if (!p) return fail(404, "not_found");
  if (body.data.action === "pay") await completePayment(paymentId);
  else await failPayment(paymentId);
  return Response.json({ purchaseId: p.id });
}
