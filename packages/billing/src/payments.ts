import { randomUUID } from "node:crypto";
import { createKaspiFromEnv } from "./kaspi";

/**
 * Оплата и возврат. Продакшен — Kaspi Pay (kaspi.ts), разработка — заглушка.
 * Платёж двухшаговый, как у Kaspi: createPayment → человек оплачивает на странице провайдера →
 * провайдер сообщает результат (webhook) и возвращает человека на returnUrl.
 * Провайдеру уходит только сумма, номер заказа и обезличенное описание — без имён и телефонов
 * (правило 12). Возврат идемпотентен по paymentId.
 */
export type PaymentRequest = {
  /** В минимальных единицах (тиынах). */
  amount: number;
  currency: string;
  /** Обезличенное описание, например «Плюс на неделю» или «Подарок в Тёплый угол». */
  description: string;
  /** Наш номер заказа (Purchase.id). */
  orderId: string;
  /** Куда вернуть человека после оплаты (абсолютный адрес сайта). */
  returnUrl: string;
};
export type PaymentStart =
  | { paymentId: string; status: "paid" }
  | { paymentId: string; status: "pending"; redirectUrl: string };
export type PaymentState = "pending" | "paid" | "failed";
export type WebhookResult = { paymentId: string; status: PaymentState };

export interface PaymentProvider {
  readonly name: string;
  /** Умеет ли списывать повторно без участия человека (для автопродления). */
  readonly supportsRecurring: boolean;
  createPayment(req: PaymentRequest): Promise<PaymentStart>;
  getStatus(paymentId: string): Promise<PaymentState>;
  refund(paymentId: string, amount: number): Promise<{ refundId: string }>;
  /** Разобрать и проверить подпись уведомления провайдера. Неверная подпись → null. */
  parseWebhook(rawBody: string, headers: Headers): Promise<WebhookResult | null>;
  /** Повторное списание по прошлому платежу (только если supportsRecurring). */
  chargeRecurring?(
    req: Omit<PaymentRequest, "returnUrl"> & { previousPaymentId: string },
  ): Promise<{ ok: true; paymentId: string } | { ok: false }>;
}

const money = (amount: number, currency: string) =>
  `${(amount / 100).toLocaleString("ru-RU")} ${currency === "KZT" ? "₸" : currency}`;

/**
 * Заглушка для разработки и тестов. Деньги не списываются.
 * - mode "redirect" (по умолчанию в разработке): ведёт на тестовую страницу /pay/stub/<id>,
 *   где можно «оплатить» или «отменить» — так же, как у настоящего провайдера.
 * - mode "instant" (тесты): платёж сразу проходит.
 */
export class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";
  readonly supportsRecurring = true;
  readonly payments = new Map<string, number>();
  readonly refunds = new Map<string, string>();
  failNextPayment = false;
  failNextRefund = false;

  constructor(readonly mode: "instant" | "redirect" = "instant") {}

  async createPayment(req: PaymentRequest): Promise<PaymentStart> {
    const paymentId = `stub_${randomUUID()}`;
    this.payments.set(paymentId, req.amount);
    console.info(`[payments:stub] платёж ${money(req.amount, req.currency)}: ${req.description}`);
    if (this.failNextPayment) {
      this.failNextPayment = false;
      throw new Error("payment unavailable");
    }
    if (this.mode === "instant") return { paymentId, status: "paid" };
    const ret = encodeURIComponent(req.returnUrl);
    return {
      paymentId,
      status: "pending",
      redirectUrl: `/pay/stub/${paymentId}?order=${req.orderId}&return=${ret}`,
    };
  }

  /** Состояние заглушки не хранится: результат приходит со страницы /pay/stub. */
  async getStatus(paymentId: string): Promise<PaymentState> {
    return this.mode === "instant" && this.payments.has(paymentId) ? "paid" : "pending";
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

  async parseWebhook() {
    return null;
  }

  async chargeRecurring(req: Omit<PaymentRequest, "returnUrl"> & { previousPaymentId: string }) {
    if (this.failNextPayment) {
      this.failNextPayment = false;
      return { ok: false as const };
    }
    const paymentId = `stub_${randomUUID()}`;
    this.payments.set(paymentId, req.amount);
    console.info(`[payments:stub] продление ${money(req.amount, req.currency)}`);
    return { ok: true as const, paymentId };
  }
}

/**
 * Оплата выключена (PAYMENT_PROVIDER=none): закрытый тест без ИП и мерчанта Kaspi.
 * «Плюс», покупка суперприветов и «Угостить» скрыты и на сервере отвечают payments_disabled;
 * всё остальное работает бесплатно. Платежей нет, поэтому и возвращать нечего.
 */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = "none";
  readonly supportsRecurring = false;

  async createPayment(): Promise<PaymentStart> {
    throw new Error("Оплата выключена (PAYMENT_PROVIDER=none)");
  }

  async getStatus(): Promise<PaymentState> {
    return "failed";
  }

  async refund(): Promise<{ refundId: string }> {
    throw new Error("Оплата выключена (PAYMENT_PROVIDER=none)");
  }

  async parseWebhook() {
    return null;
  }
}

/** Включена ли оплата: false при PAYMENT_PROVIDER=none. */
export const paymentsEnabled = (env: Record<string, string | undefined> = process.env) =>
  (env.PAYMENT_PROVIDER ?? "stub") !== "none";

let provider: PaymentProvider | null = null;

export const getPaymentProvider = (): PaymentProvider => {
  if (provider) return provider;
  const kind = process.env.PAYMENT_PROVIDER ?? "stub";
  if (kind === "kaspi") {
    provider = createKaspiFromEnv();
    return provider;
  }
  if (kind === "none") {
    provider = new DisabledPaymentProvider();
    return provider;
  }
  if (kind !== "stub")
    throw new Error(`PAYMENT_PROVIDER=${kind} не поддерживается (stub, kaspi или none)`);
  if (process.env.NODE_ENV === "production") {
    throw new Error("Заглушка оплаты запрещена в продакшене (PAYMENT_PROVIDER=kaspi)");
  }
  provider = new StubPaymentProvider(
    process.env.STUB_PAYMENT_MODE === "instant" ? "instant" : "redirect",
  );
  return provider;
};

/** Для тестов: подменить провайдера. */
export const setPaymentProvider = (p: PaymentProvider | null) => {
  provider = p;
};
