# рядом

Знакомства в реальном времени в кафе и барах (PWA). Старт — Алматы.

Всё о продукте, правилах безопасности, этапах и командах — в [CLAUDE.md](CLAUDE.md).

```
apps/web        Next.js (App Router) — PWA
apps/realtime   Socket.IO — живой список людей
apps/bot        Telegram-бот для заведений (grammY)
packages/db     Prisma-схема, миграции, сид, PostGIS-хелперы
packages/shared общие типы, zod-схемы, константы правил
```

Быстрый старт: `cp .env.example .env && pnpm install && pnpm infra:up && pnpm db:deploy && pnpm db:seed && pnpm dev`
