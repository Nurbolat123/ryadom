import { getPaymentProvider, markFailed, markPaid } from "@ryadom/billing";
import { prisma, type Prisma, type ProductCode, type Purchase } from "@ryadom/db";
import { publishUserEvent } from "@ryadom/presence";
import { redis } from "../redis";
import { createGiftFromPurchase } from "./gifts";

/**
 * Оплата в вебе: заказ (Purchase) → страница оплаты провайдера → подтверждение
 * (webhook, возврат на /pay/return или тестовая страница /pay/stub) → начисление.
 * Подарок создаётся только после оплаты.
 */

/** Адрес сайта для возврата с оплаты. Для Kaspi нужен абсолютный адрес (PUBLIC_URL). */
const returnUrl = (orderId: string) =>
  `${(process.env.PUBLIC_URL ?? "").replace(/\/$/, "")}/pay/return?order=${orderId}`;

export type CheckoutResult =
  | { status: "paid"; purchaseId: string; giftId: string | null }
  | { status: "redirect"; purchaseId: string; redirectUrl: string };

export const startCheckout = async (input: {
  userId: string;
  amount: number;
  currency: string;
  description: string;
  product?: ProductCode;
  autoRenew?: boolean;
  giftDraft?: Prisma.InputJsonValue;
}): Promise<CheckoutResult | { status: "failed" }> => {
  const payments = getPaymentProvider();
  const order = await prisma.purchase.create({
    data: {
      userId: input.userId,
      product: input.product ?? null,
      giftDraft: input.giftDraft,
      autoRenew: input.autoRenew ?? false,
      amount: input.amount,
      currency: input.currency,
      provider: payments.name,
    },
  });
  let started;
  try {
    started = await payments.createPayment({
      amount: input.amount,
      currency: input.currency,
      description: input.description,
      orderId: order.id,
      returnUrl: returnUrl(order.id),
    });
  } catch (err) {
    console.error("[payments] не удалось создать платёж:", err instanceof Error ? err.message : "");
    await prisma.purchase.update({
      where: { id: order.id },
      data: { status: "failed", failedAt: new Date() },
    });
    return { status: "failed" };
  }
  await prisma.purchase.update({ where: { id: order.id }, data: { paymentId: started.paymentId } });
  if (started.status === "pending")
    return { status: "redirect", purchaseId: order.id, redirectUrl: started.redirectUrl };
  const done = await completePayment(started.paymentId);
  return { status: "paid", purchaseId: order.id, giftId: done?.giftId ?? null };
};

/** Оплата подтверждена: начислить продукт или создать подарок. Повторный вызов — без эффекта. */
export const completePayment = async (paymentId: string) => {
  const p = await markPaid(prisma, paymentId);
  if (!p) return null;
  let giftId: string | null = null;
  if (p.giftDraft) giftId = await createGiftFromPurchase(p);
  // Счётчик суперприветов у покупателя (сигнал без данных). Про подарок узнаёт только получатель.
  else if (p.userId) await publishUserEvent(redis, { type: "inbox", userId: p.userId });
  return { purchase: p, giftId };
};

export const failPayment = (paymentId: string) => markFailed(prisma, paymentId);

export type PurchaseView = {
  id: string;
  status: "pending" | "paid" | "failed" | "refunded";
  kind: "plus" | "super_hellos" | "gift";
  product: ProductCode | null;
};

const view = (p: Purchase): PurchaseView => ({
  id: p.id,
  status: p.status,
  kind: p.giftDraft ? "gift" : p.product?.startsWith("plus") ? "plus" : "super_hellos",
  product: p.product,
});

/** Для страницы возврата: свериться с провайдером, если подтверждение ещё не пришло. */
export const syncPurchase = async (userId: string, purchaseId: string) => {
  const p = await prisma.purchase.findFirst({ where: { id: purchaseId, userId } });
  if (!p) return null;
  if (p.status === "pending" && p.paymentId) {
    const state = await getPaymentProvider()
      .getStatus(p.paymentId)
      .catch(() => "pending" as const);
    if (state === "paid") await completePayment(p.paymentId);
    if (state === "failed") await failPayment(p.paymentId);
    return view(await prisma.purchase.findUniqueOrThrow({ where: { id: p.id } }));
  }
  return view(p);
};
