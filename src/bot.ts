import { Bot, session } from "grammy";
import { conversations } from "@grammyjs/conversations";
import { knownUserOnly, isPT, isClient } from "./middleware/roleGuard.js";
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
bot.use(knownUserOnly);

// /start
bot.command("start", async (ctx) => {
  if (isPT(ctx)) {
    await ctx.reply(
      "Привіт, тренер! 💪\n\n" +
        "Команди:\n" +
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

// Start scheduler
startScheduler(bot.api);

// Start polling
bot.start({
  onStart: (info) => console.log(`@${info.username} is running`),
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());
