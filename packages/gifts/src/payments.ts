import { randomUUID } from "node:crypto";

/**
 * Оплата и возврат. Первая реализация для продакшена — Kaspi Pay (этап 9),
 * в разработке — заглушка, которая сразу «проводит» платёж.
 * Возврат идемпотентен по paymentId: повторный вызов не возвращает деньги второй раз.
 * Провайдеру уходит только сумма и обезличенное описание — без имён и телефонов (правило 12).
 */
export type ChargeRequest = {
  /** В минимальных единицах (тиынах). */
  amount: number;
  currency: string;
  /** Обезличенное описание, например «Подарок в Тёплый угол». */
  description: string;
  idempotencyKey: string;
};
export type ChargeResult = { ok: true; paymentId: string } | { ok: false; error: "payment_failed" };

export interface PaymentProvider {
  readonly name: string;
  charge(req: ChargeRequest): Promise<ChargeResult>;
  refund(paymentId: string, amount: number): Promise<{ refundId: string }>;
}

const money = (amount: number, currency: string) =>
  `${(amount / 100).toLocaleString("ru-RU")} ${currency === "KZT" ? "₸" : currency}`;

export class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  readonly charges = new Map<string, number>();
  readonly refunds = new Map<string, string>();
  /** Для тестов: следующий платёж не пройдёт / следующий возврат упадёт. */
  failNextCharge = false;
  failNextRefund = false;

  async charge(req: ChargeRequest): Promise<ChargeResult> {
    if (this.failNextCharge) {
      this.failNextCharge = false;
      return { ok: false, error: "payment_failed" };
    }
    const paymentId = `stub_${randomUUID()}`;
    this.charges.set(paymentId, req.amount);
    console.info(`[payments:stub] оплата ${money(req.amount, req.currency)}: ${req.description}`);
    return { ok: true, paymentId };
  }

  async refund(paymentId: string, amount: number) {
    if (this.failNextRefund) {
      this.failNextRefund = false;
      throw new Error("refund unavailable");
    }
    const existing = this.refunds.get(paymentId);
    if (existing) return { refundId: existing };
    const refundId = `stub_refund_${randomUUID()}`;
    this.refunds.set(paymentId, refundId);
    console.info(`[payments:stub] возврат ${money(amount, "KZT")}`);
    return { refundId };
  }
}

let provider: PaymentProvider | null = null;

export const getPaymentProvider = (): PaymentProvider => {
  if (provider) return provider;
  const kind = process.env.PAYMENT_PROVIDER ?? "stub";
  if (kind !== "stub")
    throw new Error(`PAYMENT_PROVIDER=${kind} пока не реализован (Kaspi Pay — этап 9)`);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_STUB_PAYMENTS !== "1") {
    throw new Error("Заглушка оплаты запрещена в продакшене (задайте реальный PAYMENT_PROVIDER)");
  }
  provider = new StubPaymentProvider();
  return provider;
};

/** Для тестов: подменить провайдера. */
export const setPaymentProvider = (p: PaymentProvider | null) => {
  provider = p;
};
