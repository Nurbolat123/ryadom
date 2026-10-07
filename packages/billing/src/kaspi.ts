import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  PaymentProvider,
  PaymentRequest,
  PaymentStart,
  PaymentState,
  WebhookResult,
} from "./payments";

/**
 * Kaspi Pay через REST-шлюз мерчанта.
 *
 * У Kaspi нет открытой публичной документации: формат API выдаётся при подключении
 * (напрямую или через платёжного агрегатора). Поэтому всё, что зависит от формата, собрано
 * здесь, в одном месте: адреса, поля запросов, статусы и подпись уведомлений. Перед запуском
 * сверить с выданной документацией и поправить только этот файл.
 *
 * Что уходит в Kaspi: номер заказа, сумма, валюта, обезличенное описание и адрес возврата.
 * Имён, телефонов и данных о знакомствах нет (правила 12 и 14).
 * Повторных списаний без участия человека Kaspi Pay не поддерживает — автопродление
 * с Kaspi не предлагается, вместо него напоминание продлить вручную.
 */
export type KaspiConfig = {
  /** Базовый адрес шлюза, например https://<шлюз>/api/v1 */
  apiUrl: string;
  merchantId: string;
  apiKey: string;
  /** Секрет для подписи уведомлений (HMAC-SHA256 тела, заголовок x-signature). */
  webhookSecret: string;
  fetch?: typeof fetch;
};

const STATUS: Record<string, PaymentState> = {
  CREATED: "pending",
  PENDING: "pending",
  PROCESSING: "pending",
  PAID: "paid",
  SUCCESS: "paid",
  FAILED: "failed",
  CANCELED: "failed",
  CANCELLED: "failed",
  EXPIRED: "failed",
};
const toState = (s: unknown): PaymentState => STATUS[String(s).toUpperCase()] ?? "pending";

export class KaspiPayProvider implements PaymentProvider {
  readonly name = "kaspi";
  readonly supportsRecurring = false;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: KaspiConfig) {
    this.http = cfg.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.http(`${this.cfg.apiUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.cfg.apiKey}`,
        "x-merchant-id": this.cfg.merchantId,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    // Тело ответа в лог не пишем: там может быть что угодно.
    if (!res.ok) throw new Error(`kaspi: ${method} ${path.split("/")[1]} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  async createPayment(req: PaymentRequest): Promise<PaymentStart> {
    const r = await this.call<{ paymentId: string; paymentUrl: string; status?: string }>(
      "POST",
      "/payments",
      {
        merchantId: this.cfg.merchantId,
        orderId: req.orderId,
        // Kaspi принимает сумму в тенге.
        amount: req.amount / 100,
        currency: req.currency,
        description: req.description,
        returnUrl: req.returnUrl,
      },
    );
    if (!r.paymentId || !r.paymentUrl) throw new Error("kaspi: в ответе нет paymentId/paymentUrl");
    return toState(r.status) === "paid"
      ? { paymentId: r.paymentId, status: "paid" }
      : { paymentId: r.paymentId, status: "pending", redirectUrl: r.paymentUrl };
  }

  async getStatus(paymentId: string): Promise<PaymentState> {
    const r = await this.call<{ status: string }>(
      "GET",
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return toState(r.status);
  }

  async refund(paymentId: string, amount: number) {
    const r = await this.call<{ refundId: string }>(
      "POST",
      `/payments/${encodeURIComponent(paymentId)}/refunds`,
      // Ключ идемпотентности — сам платёж: повторный запрос не вернёт деньги дважды.
      { amount: amount / 100, idempotencyKey: `refund-${paymentId}` },
    );
    return { refundId: r.refundId };
  }

  async parseWebhook(rawBody: string, headers: Headers): Promise<WebhookResult | null> {
    const got = headers.get("x-signature") ?? "";
    const want = createHmac("sha256", this.cfg.webhookSecret).update(rawBody).digest("hex");
    const a = Buffer.from(got, "utf8");
    const b = Buffer.from(want, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const body = JSON.parse(rawBody) as { paymentId?: unknown; status?: unknown };
      if (typeof body.paymentId !== "string") return null;
      return { paymentId: body.paymentId, status: toState(body.status) };
    } catch {
      return null;
    }
  }
}

export const createKaspiFromEnv = () => {
  const { KASPI_API_URL, KASPI_MERCHANT_ID, KASPI_API_KEY, KASPI_WEBHOOK_SECRET } = process.env;
  if (!KASPI_API_URL || !KASPI_MERCHANT_ID || !KASPI_API_KEY || !KASPI_WEBHOOK_SECRET) {
    throw new Error(
      "PAYMENT_PROVIDER=kaspi: задайте KASPI_API_URL, KASPI_MERCHANT_ID, KASPI_API_KEY, KASPI_WEBHOOK_SECRET",
    );
  }
  if (!KASPI_API_URL.startsWith("https://")) throw new Error("KASPI_API_URL должен быть https://");
  return new KaspiPayProvider({
    apiUrl: KASPI_API_URL.replace(/\/$/, ""),
    merchantId: KASPI_MERCHANT_ID,
    apiKey: KASPI_API_KEY,
    webhookSecret: KASPI_WEBHOOK_SECRET,
  });
};
