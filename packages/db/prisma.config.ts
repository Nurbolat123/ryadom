import { config } from "dotenv";
import { defineConfig, env } from "prisma/config";

// Единый .env в корне монорепо.
config({ path: "../../.env" });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx seed/index.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
