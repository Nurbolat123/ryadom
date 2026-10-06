import { createPrismaClient } from "@ryadom/db";
import { Redis } from "ioredis";
import { createLinkCode, LINK_TTL_SECONDS } from "./orders";

/** pnpm bot:link <slug заведения> — одноразовый код, чтобы привязать чат персонала в Telegram. */
const slug = process.argv[2];
if (!slug) {
  console.error(
    "Использование: pnpm bot:link <slug заведения>, например pnpm bot:link teplyi-ugol",
  );
  process.exit(1);
}
const db = createPrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
try {
  const venue = await db.venue.findUnique({
    where: { slug },
    select: { id: true, name: true, isPartner: true },
  });
  if (!venue) throw new Error(`Заведение ${slug} не найдено`);
  if (!venue.isPartner)
    console.warn(`Внимание: «${venue.name}» не партнёр — подарки там недоступны.`);
  const code = await createLinkCode(redis, venue.id);
  console.info(
    `Код для «${venue.name}»: ${code} (действует ${LINK_TTL_SECONDS / 60} минут).\n` +
      "Добавьте бота в чат персонала и отправьте там: /link " +
      code,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
  redis.disconnect();
}
