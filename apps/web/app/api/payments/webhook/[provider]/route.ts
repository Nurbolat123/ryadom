import { getPaymentProvider } from "@ryadom/billing";
import { fail } from "@/lib/server/http";
import { completePayment, failPayment } from "@/lib/server/payments";

export const dynamic = "force-dynamic";

/**
 * Уведомление провайдера об оплате. Подпись проверяет сам провайдер (parseWebhook);
 * неверная подпись — 401 и никаких изменений. Повторные уведомления безопасны.
 */
export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const payments = getPaymentProvider();
  if ((await params).provider !== payments.name) return fail(404, "not_found");
  const raw = await req.text();
  const event = await payments.parseWebhook(raw, req.headers);
  if (!event) return fail(401, "invalid_signature");
  if (event.status === "paid") await completePayment(event.paymentId);
  if (event.status === "failed") await failPayment(event.paymentId);
  return Response.json({ ok: true });
}
