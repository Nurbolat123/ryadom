import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import webpush from "web-push";

/**
 * `pnpm push:keys` — создать VAPID-ключи и записать их в .env, если их там ещё нет.
 * Приватный ключ в консоль не печатается. Ключи меняются только вместе со всеми подписками:
 * после смены все пользователи должны включить уведомления заново.
 */
const envPath = resolve(import.meta.dirname, "../../../.env");
let env = "";
try {
  env = readFileSync(envPath, "utf8");
} catch {
  console.error(".env не найден: сначала cp .env.example .env");
  process.exit(1);
}
const has = (name: string) => new RegExp(`^${name}=.+$`, "m").test(env);
if (has("VAPID_PUBLIC_KEY") && has("VAPID_PRIVATE_KEY")) {
  console.info("VAPID-ключи уже есть в .env — ничего не меняю.");
  process.exit(0);
}
const { publicKey, privateKey } = webpush.generateVAPIDKeys();
const set = (text: string, name: string, value: string) =>
  new RegExp(`^${name}=.*$`, "m").test(text)
    ? text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${value}`)
    : `${text.replace(/\n?$/, "\n")}${name}=${value}\n`;
env = set(env, "VAPID_PUBLIC_KEY", publicKey);
env = set(env, "VAPID_PRIVATE_KEY", privateKey);
writeFileSync(envPath, env);
console.info(
  `VAPID-ключи записаны в .env (публичный: ${publicKey.slice(0, 12)}…). Перезапусти pnpm dev.`,
);
