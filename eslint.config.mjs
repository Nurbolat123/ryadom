import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/next-env.d.ts",
      "**/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Логи не должны содержать телефонов, координат и текстов сообщений (CLAUDE.md).
      // Используем только logger из пакетов, а не голый console.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
    },
  },
);
