import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client";

export const createPrismaClient = (connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) throw new Error("DATABASE_URL не задан (см. .env.example)");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
};

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Один клиент на процесс (в dev Next.js перезагружает модули — не плодим подключения). */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
