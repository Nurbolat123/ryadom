import { RULES } from "@ryadom/shared";
import { redis } from "../redis";
import { phoneKey } from "./hash";

/** Номер, с которого указали возраст младше 18, не может зарегистрироваться 30 дней. */
const key = (phone: string) => `age-block:${phoneKey(phone)}`;

export const blockUnderage = (phone: string) =>
  redis.set(key(phone), "1", "EX", RULES.underageBlockSeconds);

export const isUnderageBlocked = async (phone: string) => (await redis.exists(key(phone))) === 1;
