import { Context, NextFunction } from "grammy";

const PT_ID = Number(process.env.PT_TELEGRAM_ID);
const CLIENT_ID = Number(process.env.CLIENT_TELEGRAM_ID);

export function isPT(ctx: Context): boolean {
  return ctx.from?.id === PT_ID;
}

export function isClient(ctx: Context): boolean {
  return ctx.from?.id === CLIENT_ID;
}

export async function ptOnly(ctx: Context, next: NextFunction) {
  if (!isPT(ctx)) {
    await ctx.reply("⛔ Тільки для тренера.");
    return;
  }
  await next();
}

export async function clientOnly(ctx: Context, next: NextFunction) {
  if (!isClient(ctx)) {
    await ctx.reply("⛔ Тільки для клієнта.");
    return;
  }
  await next();
}

export async function knownUserOnly(ctx: Context, next: NextFunction) {
  if (!isPT(ctx) && !isClient(ctx)) {
    await ctx.reply("⛔ Немає доступу.");
    return;
  }
  await next();
}
