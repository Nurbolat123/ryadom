import { randomInt } from "node:crypto";
import type { Redis } from "ioredis";

/** Привязка чата персонала в Telegram к заведению: код выдаёт админка или `pnpm bot:link`. */
export const LINK_TTL_SECONDS = 60 * 60;
export const linkKey = (code: string) => `bot-link:${code}`;

/** Одноразовый код привязки чата персонала к заведению (живёт час). */
export const createLinkCode = async (redis: Redis, venueId: string) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
  await redis.set(linkKey(code), venueId, "EX", LINK_TTL_SECONDS);
  return code;
};
