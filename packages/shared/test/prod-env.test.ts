import { describe, expect, it } from "vitest";
import { checkProductionEnv } from "../src/prod-env";

const ready = {
  DATABASE_URL: "postgresql://ryadom:s3cret-long-password@postgres:5432/ryadom",
  REDIS_URL: "redis://redis:6379",
  PUBLIC_URL: "https://ryadom.kz",
  WEB_ORIGIN: "https://ryadom.kz",
  RATE_LIMIT_SALT: "a8f3k2l9q0w7e6r5t4y3",
  PAYMENT_PROVIDER: "kaspi",
  KASPI_API_URL: "https://pay.kaspi.kz/api",
  KASPI_MERCHANT_ID: "m",
  KASPI_API_KEY: "k",
  KASPI_WEBHOOK_SECRET: "w",
  SMS_PROVIDER: "real",
  VERIFICATION_PROVIDER: "real",
  PHOTO_STORAGE: "s3",
  S3_ENDPOINT: "https://s3.example.kz",
  S3_BUCKET: "photos",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  VAPID_PUBLIC_KEY: "p",
  VAPID_PRIVATE_KEY: "q",
  TELEGRAM_BOT_TOKEN: "t",
};

const keys = (env: Record<string, string | undefined>, service: "web" | "realtime" | "bot") =>
  checkProductionEnv(env, service)
    .filter((i) => i.level === "error")
    .map((i) => i.key);

describe("проверка продакшен-настроек", () => {
  it("полный набор — без ошибок и предупреждений", () => {
    for (const s of ["web", "realtime", "bot"] as const)
      expect(checkProductionEnv(ready, s)).toEqual([]);
  });

  it("заглушки SMS, селфи и оплаты не пускают сайт в продакшен", () => {
    const env = {
      ...ready,
      SMS_PROVIDER: "console",
      VERIFICATION_PROVIDER: "stub",
      PAYMENT_PROVIDER: "stub",
    };
    expect(keys(env, "web")).toEqual(
      expect.arrayContaining(["SMS_PROVIDER", "VERIFICATION_PROVIDER", "PAYMENT_PROVIDER"]),
    );
    expect(keys(env, "realtime")).toContain("PAYMENT_PROVIDER");
  });

  it("явное разрешение заглушек для закрытого теста — только предупреждение", () => {
    const env = { ...ready, SMS_PROVIDER: "console", ALLOW_CONSOLE_SMS: "1" };
    expect(keys(env, "web")).toEqual([]);
    expect(checkProductionEnv(env, "web").map((i) => i.key)).toContain("SMS_PROVIDER");
  });

  it("пароль базы из примера, слабая соль, адрес без https — ошибки", () => {
    const env = {
      ...ready,
      DATABASE_URL: "postgresql://ryadom:ryadom_dev_password@postgres/ryadom",
      RATE_LIMIT_SALT: "change-me",
      PUBLIC_URL: "http://ryadom.kz",
      WEB_ORIGIN: "http://localhost:3000",
    };
    expect(keys(env, "web")).toEqual(
      expect.arrayContaining(["DATABASE_URL", "RATE_LIMIT_SALT", "PUBLIC_URL"]),
    );
    expect(keys(env, "realtime")).toContain("WEB_ORIGIN");
  });

  it("S3 без ключей — ошибка; фото на диске — предупреждение", () => {
    expect(keys({ ...ready, S3_ACCESS_KEY_ID: undefined }, "web")).toEqual(["S3_ACCESS_KEY_ID"]);
    const local = checkProductionEnv({ ...ready, PHOTO_STORAGE: "local" }, "web");
    expect(local).toEqual([expect.objectContaining({ level: "warning", key: "PHOTO_STORAGE" })]);
  });

  it("сообщения не содержат значений секретов", () => {
    const env = { ...ready, KASPI_API_URL: "http://secret-host", RATE_LIMIT_SALT: "short-secret" };
    const text = JSON.stringify(checkProductionEnv(env, "web"));
    expect(text).not.toContain("secret-host");
    expect(text).not.toContain("short-secret");
  });
});
