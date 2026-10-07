import { createPrismaClient } from "@ryadom/db";
import { GIFT_CHANNEL, parseGiftEvent } from "@ryadom/gifts";
import { assertProductionEnv } from "@ryadom/shared";
import { Bot, InlineKeyboard } from "grammy";
import { Redis } from "ioredis";
import { createOfferCommands } from "./offers";
import { createOrders } from "./orders";
import { TEXTS, textsFor } from "./texts";

/**
 * Telegram-бот заведений-партнёров.
 * - /link КОД — привязать чат персонала к заведению (код выдаёт `pnpm bot:link <slug>`).
 * - Принятый подарок приходит заказом: позиция, код выдачи, столик и кнопка «Выдано».
 * - /redeem КОД — погасить код скидки по предложению; /report — отчёт по предложениям за 7 дней.
 * - /lang kk|ru — язык бота в этом чате (по умолчанию русский).
 * Логи без имён, телефонов и текстов.
 */
assertProductionEnv("bot");
const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.warn("bot: TELEGRAM_BOT_TOKEN не задан в .env — бот не запущен.");
  process.exit(0);
}

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const db = createPrismaClient();
const redis = new Redis(redisUrl);
const sub = new Redis(redisUrl);
const bot = new Bot(token);

const orders = createOrders({
  db,
  redis,
  api: {
    sendMessage: async (chatId, text, buttons = []) => {
      const keyboard = new InlineKeyboard();
      for (const b of buttons) keyboard.text(b.text, b.callback_data);
      await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
    },
  },
});

const offers = createOfferCommands(db);

bot.command("start", async (ctx) => {
  const locale = await orders.localeOf(String(ctx.chat.id));
  // Чат ещё не привязан — язык неизвестен, показываем оба.
  return ctx.reply(locale ? TEXTS[locale].start : `${TEXTS.ru.start}\n\n${TEXTS.kk.start}`);
});

bot.command("lang", async (ctx) =>
  ctx.reply(await orders.setLocale(String(ctx.chat.id), ctx.match ?? "")),
);

bot.command("redeem", async (ctx) =>
  ctx.reply(await offers.redeem(String(ctx.chat.id), ctx.match ?? "")),
);
bot.command("report", async (ctx) => ctx.reply(await offers.report(String(ctx.chat.id))));

bot.command("link", async (ctx) => {
  const code = ctx.match?.trim();
  if (!code) return ctx.reply(`${TEXTS.ru.linkUsage}\n${TEXTS.kk.linkUsage}`);
  const linked = await orders.link(code, String(ctx.chat.id));
  return ctx.reply(
    linked
      ? textsFor(linked.locale).linked(linked.name)
      : `${TEXTS.ru.linkFailed}\n${TEXTS.kk.linkFailed}`,
  );
});

bot.on("callback_query:data", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (chatId === undefined) return ctx.answerCallbackQuery();
  const res = await orders.onButton(ctx.callbackQuery.data, String(chatId));
  await ctx.answerCallbackQuery({ text: res.text });
  if (res.ok) {
    const text = ctx.callbackQuery.message?.text ?? "";
    await ctx.editMessageText(`${text}\n\n${res.suffix}`).catch(() => undefined);
  }
});

bot.catch((err) => {
  console.error(
    "bot: ошибка обработки апдейта",
    err.error instanceof Error ? err.error.message : "",
  );
});

await sub.subscribe(GIFT_CHANNEL);
sub.on("message", (_channel, raw) => {
  const e = parseGiftEvent(raw);
  if (e) void orders.announce(e.giftId).catch(() => undefined);
});
// Если бот был выключен, пока гости принимали подарки, — дошлём при старте и раз в минуту.
setInterval(() => void orders.announcePending().catch(() => undefined), 60_000);

await bot.start({
  onStart: (me) => {
    console.info(`bot: запущен как @${me.username}`);
    void orders.announcePending();
  },
});
