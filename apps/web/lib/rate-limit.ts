import { createHash } from "node:crypto";
import { redis } from "./redis";

/**
 * Простой лимит «не больше N за окно» в Redis.
 * Ключ — хэш (IP или userId), сам IP нигде не хранится и не пишется в логи.
 */
export const rateLimit = async (
  bucket: string,
  identity: string,
  limit: number,
  windowSec: number,
): Promise<{ ok: boolean; retryAfterSec: number }> => {
  const salt = process.env.RATE_LIMIT_SALT ?? "";
  const id = createHash("sha256").update(`${salt}:${identity}`).digest("hex").slice(0, 32);
  const key = `rl:${bucket}:${id}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSec);
  if (count <= limit) return { ok: true, retryAfterSec: 0 };
  const ttl = await redis.ttl(key);
  return { ok: false, retryAfterSec: ttl > 0 ? ttl : windowSec };
};

/** IP клиента за прокси (Next.js отдаёт заголовки как есть). */
export const clientIp = (req: Request): string =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("x-real-ip") ||
  "unknown";
