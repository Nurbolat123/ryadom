import { createPrismaClient } from "@ryadom/db";
import { Redis } from "ioredis";
import { createRealtime } from "./server";

const port = Number(process.env.REALTIME_PORT ?? 4000);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

// В GitHub Codespaces сайт открыт по адресу https://<codespace>-3000.<домен> — разрешаем его автоматически.
const origins = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",");
const { CODESPACE_NAME, GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: CS_DOMAIN } = process.env;
if (CODESPACE_NAME && CS_DOMAIN) origins.push(`https://${CODESPACE_NAME}-3000.${CS_DOMAIN}`);

const { http } = createRealtime({
  db: createPrismaClient(),
  redis: new Redis(redisUrl),
  sub: new Redis(redisUrl),
  corsOrigin: origins,
});

http.listen(port, () => {
  console.info(`realtime: слушаю :${port}`);
});
