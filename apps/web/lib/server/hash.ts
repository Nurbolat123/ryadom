import { createHash, randomBytes } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Хэш телефона для ключей Redis: сам номер в Redis не кладём. */
export const phoneKey = (phone: string) =>
  sha256(`${process.env.RATE_LIMIT_SALT ?? ""}:phone:${phone}`).slice(0, 32);

export const randomToken = () => randomBytes(32).toString("base64url");
