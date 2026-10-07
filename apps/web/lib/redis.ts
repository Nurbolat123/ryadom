import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

/** Один клиент Redis на процесс. */
export const redis: Redis =
  globalForRedis.redis ??
  new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 2,
    // Подключение при первой команде: сборка (next build) импортирует модуль без Redis.
    lazyConnect: true,
  });
if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;
