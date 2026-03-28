import { Bot, session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { knownUserOnly, isPT, isClient } from "./middleware/roleGuard.js";
import { requestLogger } from "./middleware/logger.js";
import logger from "./lib/logger.js";
import { registerPTHandlers } from "./handlers/pt.js";
import { registerClientHandlers } from "./handlers/client.js";
import { startScheduler } from "./services/scheduler.js";
import type { MyContext } from "./handlers/pt.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("BOT_TOKEN is not set");

const bot = new Bot<MyContext>(token);

// Middleware — session must come before conversations
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(requestLogger);
bot.use(knownUserOnly);

// /start
bot.command("start", async (ctx) => {
  if (isPT(ctx)) {
    await ctx.reply(
      "Привіт, тренер! 💪\n\n" +
        "Команди:\n" +
        "/newpackage — створити пакет занять\n" +
        "/newworkout — створити тренування\n" +
        "/clone — клонувати минуле тренування\n" +
        "/history — список тренувань"
    );
  } else if (isClient(ctx)) {
    await ctx.reply(
      "Привіт! 👋\n\n" +
        "Команди:\n" +
        "/today — переглянути сьогоднішнє тренування\n" +
        "/session — прогрес пакету"
    );
  }
});

// Register handlers
registerPTHandlers(bot);
registerClientHandlers(bot);

// Register bot commands in Telegram menu (scope per role)
await bot.api.setMyCommands(
  [
    { command: "newpackage", description: "Створити пакет занять" },
    { command: "newworkout", description: "Створити тренування" },
    { command: "clone", description: "Клонувати минуле тренування" },
    { command: "history", description: "Список тренувань" },
  ],
  { scope: { type: "chat", chat_id: Number(process.env.PT_TELEGRAM_ID) } }
);

await bot.api.setMyCommands(
  [
    { command: "today", description: "Переглянути сьогоднішнє тренування" },
    { command: "session", description: "Прогрес пакету" },
  ],
  { scope: { type: "chat", chat_id: Number(process.env.CLIENT_TELEGRAM_ID) } }
);

// Start scheduler
startScheduler(bot.api);

// Start polling
bot.start({
  onStart: (info) => logger.info(`@${info.username} is running`),
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
