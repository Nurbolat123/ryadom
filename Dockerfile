# syntax=docker/dockerfile:1
# Продакшен-образ «рядом»: один образ для web, realtime, бота и служебных команд
# (миграции, сид, импорт заведений). Какой сервис запускать — задаёт docker-compose.prod.yml.
# Секретов в образе нет: всё приходит из .env при запуске.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm той же версии, что в package.json (packageManager); ставится в образ, без загрузки при запуске.
RUN npm install -g pnpm@10.0.0 && npm cache clean --force
WORKDIR /app

# Зависимости отдельным слоем: пересобираются, только когда меняются package.json или lockfile.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/realtime/package.json apps/realtime/
COPY apps/bot/package.json apps/bot/
COPY packages/billing/package.json packages/billing/
COPY packages/db/package.json packages/db/prisma.config.ts packages/db/
COPY packages/db/prisma packages/db/prisma
COPY packages/gifts/package.json packages/gifts/
COPY packages/places/package.json packages/places/
COPY packages/presence/package.json packages/presence/
COPY packages/push/package.json packages/push/
COPY packages/shared/package.json packages/shared/
COPY packages/venues/package.json packages/venues/
# prisma generate (postinstall) читает prisma.config.ts, где нужен DATABASE_URL; к базе не подключается.
RUN DATABASE_URL=postgresql://build@localhost/build pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
# Браузер подключается к realtime по адресу сайта: Caddy отдаёт /socket.io в realtime.
# Адрес базы при сборке нужен только модулям для импорта; подключений во время сборки нет.
RUN cd apps/web && NODE_ENV=production \
    NEXT_PUBLIC_REALTIME_URL=same-origin \
    REALTIME_INTERNAL_URL=http://realtime:4000 \
    DATABASE_URL=postgresql://build@localhost:1/build \
    node_modules/.bin/next build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data/photos && chown node:node /data/photos
USER node
EXPOSE 3000 4000
CMD ["sh", "-c", "cd apps/web && exec node_modules/.bin/next start -p 3000 -H 0.0.0.0"]
