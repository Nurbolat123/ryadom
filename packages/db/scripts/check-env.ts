import { config } from "dotenv";

/**
 * `pnpm check:env` — чего не хватает для продакшена: по каждому сервису ошибки (сервис не
 * запустится) и предупреждения. Значения секретов не печатаются. Выход 1, если есть ошибки.
 */
config({ path: "../../.env" });
const { checkProductionEnv } = await import("@ryadom/shared");

let errors = 0;
for (const service of ["web", "realtime", "bot"] as const) {
  const issues = checkProductionEnv(process.env, service);
  console.info(`\n${service}:${issues.length ? "" : " всё готово"}`);
  for (const i of issues) {
    if (i.level === "error") errors++;
    console.info(`  ${i.level === "error" ? "✗" : "!"} ${i.key} — ${i.message}`);
  }
}
console.info(
  errors
    ? `\nОшибок: ${errors}. В продакшене сервисы с ошибками не запустятся.`
    : "\nГотово к запуску.",
);
process.exit(errors ? 1 : 0);
