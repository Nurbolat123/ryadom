/**
 * Проверка настроек продакшена при старте сервиса и командой `pnpm check:env`.
 * error — сервис не запустится; warning — запустится, но что-то выключено или небезопасно.
 * Значения секретов в сообщения не попадают — только имена переменных.
 */
export type EnvService = "web" | "realtime" | "bot";
export type EnvIssue = { level: "error" | "warning"; key: string; message: string };

type Env = Record<string, string | undefined>;

const DEV_DB_PASSWORD = "ryadom_dev_password";
const isHttps = (v: string | undefined) => !!v && /^https:\/\/[^/]+/.test(v);

export const checkProductionEnv = (env: Env, service: EnvService): EnvIssue[] => {
  const issues: EnvIssue[] = [];
  const error = (key: string, message: string) => issues.push({ level: "error", key, message });
  const warn = (key: string, message: string) => issues.push({ level: "warning", key, message });
  const required = (key: string, message = "не задано") => {
    if (!env[key]) error(key, message);
  };

  required("DATABASE_URL");
  if (env.DATABASE_URL?.includes(DEV_DB_PASSWORD))
    error("DATABASE_URL", "пароль базы из примера для разработки — задайте свой");
  required("REDIS_URL");

  // Оплата: web создаёт заказы, realtime делает возвраты и продления.
  if (service !== "bot") {
    if (env.PAYMENT_PROVIDER !== "kaspi")
      error("PAYMENT_PROVIDER", "в продакшене только kaspi (заглушка оплаты запрещена)");
    else {
      if (!isHttps(env.KASPI_API_URL)) error("KASPI_API_URL", "нужен адрес https:// от Kaspi");
      for (const key of ["KASPI_MERCHANT_ID", "KASPI_API_KEY", "KASPI_WEBHOOK_SECRET"])
        required(key, "выдаётся при подключении мерчанта Kaspi");
    }
  }

  if (service === "web") {
    if (!isHttps(env.PUBLIC_URL))
      error("PUBLIC_URL", "адрес сайта с https://, например https://ryadom.kz");
    const salt = env.RATE_LIMIT_SALT ?? "";
    if (salt.length < 16 || salt === "change-me")
      error("RATE_LIMIT_SALT", "случайная строка не короче 16 символов");

    const sms = env.SMS_PROVIDER ?? "console";
    if (sms === "console") {
      if (env.ALLOW_CONSOLE_SMS === "1")
        warn(
          "SMS_PROVIDER",
          "коды входа пишутся в лог вместо SMS (ALLOW_CONSOLE_SMS=1) — только для закрытого теста",
        );
      else error("SMS_PROVIDER", "нужен настоящий SMS-провайдер (заглушка console запрещена)");
    }
    const verification = env.VERIFICATION_PROVIDER ?? "stub";
    if (verification === "stub") {
      if (env.ALLOW_STUB_VERIFICATION === "1")
        warn(
          "VERIFICATION_PROVIDER",
          "селфи-проверка одобряет любое фото (ALLOW_STUB_VERIFICATION=1)",
        );
      else
        error("VERIFICATION_PROVIDER", "нужна настоящая селфи-проверка (заглушка stub запрещена)");
    }

    const photos = env.PHOTO_STORAGE ?? "local";
    if (photos === "s3") {
      if (!isHttps(env.S3_ENDPOINT))
        error("S3_ENDPOINT", "адрес S3-хранилища в Казахстане, https://");
      for (const key of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) required(key);
    } else if (photos === "local") {
      warn(
        "PHOTO_STORAGE",
        "фото на диске сервера: подходит, только если сервер в Казахстане и диск в резервной копии",
      );
    } else error("PHOTO_STORAGE", "local или s3");
  }

  if (service === "realtime") {
    const origins = (env.WEB_ORIGIN ?? "").split(",").filter(Boolean);
    if (!origins.length || origins.some((o) => !isHttps(o)))
      error("WEB_ORIGIN", "адрес сайта с https://, тот же, что PUBLIC_URL");
  }

  if (service !== "bot" && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY))
    warn("VAPID_PUBLIC_KEY", "ключей Web Push нет — уведомления выключены (pnpm push:keys)");

  if (service === "bot" && !env.TELEGRAM_BOT_TOKEN)
    warn("TELEGRAM_BOT_TOKEN", "токена нет — бот не запущен, подарки персоналу не приходят");

  return issues;
};

/**
 * Вызывается при старте сервиса. В продакшене (NODE_ENV=production) при ошибках
 * печатает список и завершает процесс; предупреждения только печатает.
 */
export const assertProductionEnv = (service: EnvService, env: Env = process.env): void => {
  if (env.NODE_ENV !== "production") return;
  const issues = checkProductionEnv(env, service);
  for (const i of issues) {
    if (i.level === "error") console.error(`${service}: ОШИБКА ${i.key} — ${i.message}`);
    else console.warn(`${service}: внимание ${i.key} — ${i.message}`);
  }
  if (issues.some((i) => i.level === "error")) {
    console.error(`${service}: продакшен-настройки неполные, сервис не запущен (pnpm check:env).`);
    process.exit(1);
  }
};
