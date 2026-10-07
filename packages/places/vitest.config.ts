import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    // Тесты ходят в одну базу — запускаем последовательно.
    fileParallelism: false,
  },
});
