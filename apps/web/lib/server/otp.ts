import { randomInt } from "node:crypto";
import { RULES } from "@ryadom/shared";
import { redis } from "../redis";
import { rateLimit } from "../rate-limit";
import { phoneKey, sha256 } from "./hash";
import { ConsoleSmsProvider, getSmsProvider, loginCodeText } from "./sms";

export type RequestCodeResult =
  | { ok: true; resendAfterSec: number; devCode?: string }
  | { ok: false; error: "cooldown" | "rate_limited"; retryAfterSec: number };

const codeKey = (phone: string) => `otp:code:${phoneKey(phone)}`;
const cooldownKey = (phone: string) => `otp:cooldown:${phoneKey(phone)}`;

/** Отправить код входа. Не сообщает, зарегистрирован ли номер. */
export const requestLoginCode = async (
  phone: string,
  ip: string,
  locale: "ru" | "kk" = "ru",
): Promise<RequestCodeResult> => {
  const cooldown = await redis.ttl(cooldownKey(phone));
  if (cooldown > 0) return { ok: false, error: "cooldown", retryAfterSec: cooldown };

  const byIp = await rateLimit("otp-ip", ip, RULES.otpPerIpPerHour, 3600);
  if (!byIp.ok) return { ok: false, error: "rate_limited", retryAfterSec: byIp.retryAfterSec };
  const byPhone = await rateLimit("otp-phone", phone, RULES.otpPerPhonePerHour, 3600);
  if (!byPhone.ok)
    return { ok: false, error: "rate_limited", retryAfterSec: byPhone.retryAfterSec };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await redis
    .multi()
    .hset(codeKey(phone), { hash: sha256(`${phoneKey(phone)}:${code}`), attempts: 0 })
    .expire(codeKey(phone), RULES.otpTtlSeconds)
    .set(cooldownKey(phone), "1", "EX", RULES.otpResendCooldownSeconds)
    .exec();
  const sms = getSmsProvider();
  await sms.sendCode(phone, code, loginCodeText(code, locale));
  // Режим разработки без SMS: код показываем прямо на экране (в продакшене — никогда).
  const devCode =
    sms instanceof ConsoleSmsProvider && process.env.NODE_ENV !== "production" ? code : undefined;
  return { ok: true, resendAfterSec: RULES.otpResendCooldownSeconds, devCode };
};

export type VerifyCodeResult =
  { ok: true } | { ok: false; error: "invalid" | "expired" | "too_many_attempts" };

/** Проверить код. После RULES.otpMaxAttempts неверных попыток код сгорает. */
export const verifyLoginCode = async (phone: string, code: string): Promise<VerifyCodeResult> => {
  const key = codeKey(phone);
  const stored = await redis.hgetall(key);
  if (!stored.hash) return { ok: false, error: "expired" };

  const attempts = await redis.hincrby(key, "attempts", 1);
  if (attempts > RULES.otpMaxAttempts) {
    await redis.del(key);
    return { ok: false, error: "too_many_attempts" };
  }
  if (stored.hash !== sha256(`${phoneKey(phone)}:${code}`)) {
    if (attempts >= RULES.otpMaxAttempts) await redis.del(key);
    return { ok: false, error: attempts >= RULES.otpMaxAttempts ? "too_many_attempts" : "invalid" };
  }
  await redis.del(key);
  return { ok: true };
};
