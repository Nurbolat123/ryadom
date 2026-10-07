#!/usr/bin/env bash
# Резервная копия базы (и фото, если они на диске сервера). Запуск из корня проекта на сервере;
# в cron — каждую ночь (см. deploy/README.md). Хранит 14 последних копий в deploy/backups.
# Копии содержат персональные данные: держать их только на серверах в Казахстане (правило 12).
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
DIR=deploy/backups
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DIR"
chmod 700 "$DIR"

# Формат custom: восстановление — pg_restore (см. deploy/README.md).
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DIR/db_$STAMP.dump"

# Фото на диске (PHOTO_STORAGE=local). С S3 копии делает само хранилище.
if grep -q '^PHOTO_STORAGE=local' .env 2>/dev/null; then
  $COMPOSE run --rm --no-deps -T tools tar -C /data -czf - photos > "$DIR/photos_$STAMP.tar.gz"
fi

ls -1t "$DIR"/db_*.dump | tail -n +15 | xargs -r rm --
ls -1t "$DIR"/photos_*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "Копия готова: $DIR/db_$STAMP.dump"
