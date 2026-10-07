import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KaspiPayProvider } from "../src";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

const fake = (reply: (c: Call) => unknown) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const c: Call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(c);
    return new Response(JSON.stringify(reply(c)), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};

const kaspi = (fetchImpl: typeof fetch) =>
  new KaspiPayProvider({
    apiUrl: "https://gw.example/api",
    merchantId: "m1",
    apiKey: "key",
    webhookSecret: "secret",
    fetch: fetchImpl,
  });

describe("Kaspi Pay", () => {
  it("платёж: сумма в тенге, без персональных данных, переход на страницу оплаты", async () => {
    const { calls, fetchImpl } = fake(() => ({
      paymentId: "k1",
      paymentUrl: "https://pay.example/k1",
      status: "CREATED",
    }));
    const start = await kaspi(fetchImpl).createPayment({
      amount: 99000,
      currency: "KZT",
      description: "Плюс на неделю",
      orderId: "order-1",
      returnUrl: "https://ryadom.kz/pay/return?order=order-1",
    });
    expect(start).toEqual({
      paymentId: "k1",
      status: "pending",
      redirectUrl: "https://pay.example/k1",
    });
    expect(calls[0]).toMatchObject({ url: "https://gw.example/api/payments", method: "POST" });
    expect(calls[0]!.body).toEqual({
      merchantId: "m1",
      orderId: "order-1",
      amount: 990,
      currency: "KZT",
      description: "Плюс на неделю",
      returnUrl: "https://ryadom.kz/pay/return?order=order-1",
    });
    expect(calls[0]!.headers.authorization).toBe("Bearer key");
  });

  it("статусы и возврат с ключом идемпотентности", async () => {
    const { calls, fetchImpl } = fake((c) =>
      c.method === "GET" ? { status: "SUCCESS" } : { refundId: "r1" },
    );
    const k = kaspi(fetchImpl);
    expect(await k.getStatus("k1")).toBe("paid");
    expect(await k.refund("k1", 120000)).toEqual({ refundId: "r1" });
    expect(calls[1]).toMatchObject({
      url: "https://gw.example/api/payments/k1/refunds",
      body: { amount: 1200, idempotencyKey: "refund-k1" },
    });
  });

  it("ошибка шлюза — исключение без тела ответа", async () => {
    const fetchImpl = (async () =>
      new Response("secret details", { status: 500 })) as unknown as typeof fetch;
    await expect(kaspi(fetchImpl).getStatus("k1")).rejects.toThrow(/HTTP 500/);
    await expect(kaspi(fetchImpl).getStatus("k1")).rejects.not.toThrow(/secret/);
  });

  it("уведомление принимается только с верной подписью", async () => {
    const k = kaspi(fake(() => ({})).fetchImpl);
    const body = JSON.stringify({ paymentId: "k1", status: "PAID" });
    const sign = (s: string) => createHmac("sha256", s).update(body).digest("hex");
    expect(await k.parseWebhook(body, new Headers({ "x-signature": sign("secret") }))).toEqual({
      paymentId: "k1",
      status: "paid",
    });
    expect(await k.parseWebhook(body, new Headers({ "x-signature": sign("wrong") }))).toBeNull();
    expect(await k.parseWebhook(body, new Headers())).toBeNull();
  });

  it("повторных списаний нет — автопродление с Kaspi не предлагается", () => {
    const k = kaspi(fake(() => ({})).fetchImpl);
    expect(k.supportsRecurring).toBe(false);
    expect("chargeRecurring" in k).toBe(false);
  });
});
