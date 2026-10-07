/** При старте сервера: в продакшене без нужных настроек сайт не запускается (pnpm check:env). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertProductionEnv } = await import("@ryadom/shared");
  assertProductionEnv("web");
}
