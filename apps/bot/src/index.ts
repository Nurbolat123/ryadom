import { Bot } from "grammy";

/**
 * Каркас Telegram-бота заведений. Заказы подарков, коды выдачи и кнопка «Выдано» — этап 8.
 */
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.warn("bot: TELEGRAM_BOT_TOKEN не задан в .env — бот не запущен (нужен с этапа 8).");
  process.exit(0);
}

const bot = new Bot(token);

bot.command("start", (ctx) =>
  ctx.reply("Бот заведения «рядом». Здесь будут приходить заказы подарков для персонала."),
);

bot.catch((err) => {
  console.error(
    "bot: ошибка обработки апдейта",
    err.error instanceof Error ? err.error.message : "",
  );
});

await bot.start({ onStart: (me) => console.info(`bot: запущен как @${me.username}`) });
