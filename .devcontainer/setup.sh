#!/usr/bin/env bash
# Первый запуск Codespace: зависимости, база, миграции, сид.
set -euo pipefail
cd "$(dirname "$0")/.."

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
sudo corepack enable
[ -f .env ] || cp .env.example .env
pnpm install
pnpm push:keys   # VAPID-ключи для Web Push (если их ещё нет в .env)

docker compose up -d --wait postgres redis
pnpm db:deploy
pnpm db:seed

echo
echo "Готово. Запусти: pnpm dev"
