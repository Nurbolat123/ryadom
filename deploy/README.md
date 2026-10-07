# Запуск «рядом» на сервере

Всё работает в Docker на одном сервере: сайт, realtime, Telegram-бот, PostgreSQL + PostGIS, Redis и Caddy. Caddy сам выпускает и продлевает HTTPS-сертификат.
Наружу открыты только порты 80 и 443. База, Redis и сервисы доступны только во внутренней сети Docker.

```
браузер ──https──► Caddy :443 ─┬─ /socket.io/* ──► realtime :4000
                               └─ всё остальное ─► web :3000
                                  web, realtime, bot ──► postgres, redis
```

## Что нужно подготовить

| Что                       | Зачем                                                     | Где взять                                                                                                                              |
| ------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Сервер в Казахстане       | персональные данные граждан РК хранятся в РК (правило 12) | VPS у казахстанского провайдера, например PS Cloud (ps.kz), QazCloud или Hoster.kz; Ubuntu 24.04, от 2 vCPU / 4 ГБ / 40 ГБ SSD         |
| Домен                     | адрес сайта и HTTPS                                       | A-запись домена на IP сервера                                                                                                          |
| S3-хранилище в Казахстане | фото профилей                                             | объектное хранилище того же провайдера: адрес, регион, приватный бакет, ключи                                                          |
| SMS-провайдер             | коды входа                                                | договор с SMS-шлюзом. Под него пишется адаптер `SmsProvider` (`apps/web/lib/server/sms.ts`)                                            |
| Селфи-проверка            | только подтверждённые люди в списке                       | сервис проверки лица. Под него пишется адаптер `VerificationProvider` (`apps/web/lib/server/verification.ts`)                          |
| Kaspi Pay                 | «Плюс», суперприветы, подарки                             | данные мерчанта: адрес API, ID, ключ, секрет уведомлений. Поля адаптера сверяются по их документации (`packages/billing/src/kaspi.ts`) |
| Telegram-бот              | заказы подарков персоналу                                 | токен от @BotFather                                                                                                                    |

Пока SMS-провайдера и селфи-проверки нет, можно запустить **закрытый тест** на этом же сервере:

- `ALLOW_CONSOLE_SMS=1`: коды входа пишутся в журнал web (`docker compose logs web`), на экран не выводятся;
- `ALLOW_STUB_VERIFICATION=1`: селфи-проверка одобряет любое фото.

Оплата без Kaspi в продакшене не запускается: заглушка оплаты запрещена.

## 1. Подготовить сервер

```bash
# Docker и Compose (официальный скрипт Docker)
curl -fsSL https://get.docker.com | sh

# Файрвол: SSH, HTTP, HTTPS
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443 && ufw enable

# Код
git clone https://github.com/Nurbolat123/ryadom.git /srv/ryadom
cd /srv/ryadom
```

## 2. Настройки

```bash
cp deploy/env.production.example .env
chmod 600 .env
openssl rand -hex 24   # → POSTGRES_PASSWORD
openssl rand -hex 32   # → RATE_LIMIT_SALT
nano .env              # домен, S3, Kaspi, токен бота…
```

**Ключи Web Push** создаются один раз (команда допишет их в `.env`):

```bash
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm --no-deps --user root \
  -v "$PWD/.env:/app/.env" tools pnpm push:keys
```

**Проверка настроек** перечисляет, чего не хватает каждому сервису (значения не печатаются):

```bash
docker compose -f docker-compose.prod.yml run --rm --no-deps tools
```

Сервис с ошибкой в настройках не запускается и пишет причину в журнал. Предупреждения его не останавливают.

## 3. Запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

Миграции базы применяются сами перед запуском сайта (сервис `migrate`). Проверка: `https://<домен>/api/health` должен вернуть `{"ok":true,…}`.

Первичные данные: интересы и цены. Тестовые заведения в продакшене не создаются.
Затем заведения из OpenStreetMap и права модератора:

```bash
T="docker compose -f docker-compose.prod.yml run --rm tools"
$T pnpm db:seed
$T pnpm venues:import --all
# сначала зарегистрируйся на сайте, затем:
$T pnpm admin:grant +77011234567
```

Дальше всё делается в админке `/admin`: заведения, партнёры, меню, привязка Telegram-чатов, предложения.

## 4. Kaspi и Telegram

- **Kaspi:** адрес уведомлений об оплате — `https://<домен>/api/payments/webhook/kaspi`, возврат после оплаты — `https://<домен>/pay/return`.
- **Telegram:** бот стартует сам, если в `.env` есть `TELEGRAM_BOT_TOKEN`. Чат персонала привязывается в админке: карточка заведения → «Telegram персонала».

## 5. Регулярные задачи (cron на сервере)

`crontab -e`:

```
# Резервная копия базы каждую ночь в 03:30
30 3 * * *  cd /srv/ryadom && deploy/backup.sh >> /var/log/ryadom-backup.log 2>&1
# Обновление заведений из OpenStreetMap по понедельникам в 04:00
0 4 * * 1   cd /srv/ryadom && docker compose -f docker-compose.prod.yml run --rm tools pnpm venues:import --all >> /var/log/ryadom-import.log 2>&1
```

Копии лежат в `deploy/backups`, хранятся 14 последних. В них персональные данные, поэтому второй экземпляр копируй только на хранилище в Казахстане, например в бакет того же S3.

Восстановление базы из копии:

```bash
docker compose -f docker-compose.prod.yml stop web realtime bot
docker compose -f docker-compose.prod.yml exec -T postgres \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < deploy/backups/db_<дата>.dump
docker compose -f docker-compose.prod.yml up -d
```

## 6. Обновление

```bash
cd /srv/ryadom
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Новые миграции применяются сами. Сессии пользователей и отметки в заведениях сохраняются.

## Журналы и наблюдение

- Журналы: `docker compose -f docker-compose.prod.yml logs -f web realtime bot`. В них нет телефонов (номер замаскирован), координат и текстов сообщений. Caddy журнал запросов не пишет.
- Состояние: `docker compose -f docker-compose.prod.yml ps` (web и realtime с проверкой здоровья), `https://<домен>/api/health`.
- Каждый пуш в `main` проверяется на GitHub (вкладка Actions): типы, линтер, все тесты и сборка образа.
