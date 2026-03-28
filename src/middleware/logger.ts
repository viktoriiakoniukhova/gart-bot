import { Context, NextFunction } from "grammy";
import logger from "../lib/logger.js";

export async function requestLogger(ctx: Context, next: NextFunction) {
  const start = Date.now();
  const from = ctx.from;
  const userId = from?.id;
  const username = from?.username ?? from?.first_name ?? "unknown";

  // Determine what was called
  const command = ctx.message?.text?.split(" ")[0] ?? null;
  const callbackData = ctx.callbackQuery?.data ?? null;
  const updateType = ctx.message
    ? command?.startsWith("/")
      ? "command"
      : "message"
    : ctx.callbackQuery
    ? "callback"
    : "unknown";

  const label = command ?? callbackData ?? updateType;

  logger.info({ userId, username, type: updateType, label }, `→ ${label}`);

  await next();

  const ms = Date.now() - start;
  logger.info({ userId, username, type: updateType, label, ms }, `← ${label} (${ms}ms)`);
}
