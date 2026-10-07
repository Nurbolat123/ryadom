import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Пакеты монорепо поставляются как TypeScript-исходники.
  transpilePackages: [
    "@ryadom/shared",
    "@ryadom/db",
    "@ryadom/venues",
    "@ryadom/presence",
    "@ryadom/gifts",
    "@ryadom/billing",
  ],
  // Не генерировать AGENTS.md/CLAUDE.md внутри apps/web: правила проекта в корневом CLAUDE.md.
  agentRules: false,
  // Режим разработки через GitHub Codespaces: сайт открыт с адреса *.app.github.dev.
  allowedDevOrigins: ["*.app.github.dev"],
  // Socket.IO через адрес сайта: нужно там, где наружу открыт только порт сайта (Codespaces).
  // Через прокси работает long-polling; на своём компьютере клиент ходит в :4000 напрямую по WebSocket.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const realtime = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:4000";
    // Socket.IO требует слеш в конце пути, :path* его теряет — отдельное правило для корня.
    return [
      { source: "/socket.io/", destination: `${realtime}/socket.io/` },
      { source: "/socket.io/:path+", destination: `${realtime}/socket.io/:path+` },
    ];
  },
  // Service worker: всегда свежий файл и область действия на весь сайт.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "sharp"],
};

export default withNextIntl(nextConfig);
