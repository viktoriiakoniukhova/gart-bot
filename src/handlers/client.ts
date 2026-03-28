import { Bot } from "grammy";
import type { Session, Exercise } from "@prisma/client";
import prisma from "../db/prisma.js";
import { clientOnly } from "../middleware/roleGuard.js";
import logger from "../lib/logger.js";
import type { MyContext } from "./pt.js";

const PT_ID = Number(process.env.PT_TELEGRAM_ID);

// ── Workout formatter ─────────────────────────────────────────────────────────

export function formatWorkout(
  session: Session & { exercises: Exercise[] }
): string {
  let text = `<b>🏋️ Тренування №${session.sessionNumber}</b>\n`;
  const date = session.scheduledDate.toLocaleDateString("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  text += `📅 ${date}\n`;

  if (session.hasWarmup) text += "🔥 Розминка: так\n";

  text += "\n";

  let currentSection = "";
  for (const ex of session.exercises) {
    if (ex.section !== currentSection) {
      currentSection = ex.section;
      text += `<b>${currentSection}</b>\n`;
    }
    text += `• <b>${ex.name}</b>\n`;
    text += `  ${ex.sets} підходи × ${ex.reps}\n`;
    text += `  Навантаження: ${ex.load}\n`;
  }

  if (session.workoutNotes) {
    text += `\n📝 <i>${session.workoutNotes}</i>`;
  }

  return text;
}

// ── /today ────────────────────────────────────────────────────────────────────

async function todayHandler(ctx: MyContext) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const session = await prisma.session.findFirst({
    where: {
      scheduledDate: { gte: today, lt: tomorrow },
      status: { in: ["DELIVERED", "WORKOUT_CREATED", "CONFIRMED"] },
    },
    include: {
      exercises: { orderBy: { orderIndex: "asc" } },
    },
  });

  if (!session) {
    await ctx.reply("Сьогодні тренування немає 😊");
    return;
  }

  // Mark as read
  if (!session.clientReadAt) {
    await prisma.session.update({
      where: { id: session.id },
      data: { clientReadAt: new Date() },
    });

    logger.info(
      { sessionId: session.id, sessionNumber: session.sessionNumber, clientId: ctx.from?.id },
      `client read receipt: session #${session.sessionNumber}`
    );

    // Notify PT
    if (PT_ID) {
      await ctx.api.sendMessage(
        PT_ID,
        `👁 Клієнт переглянув тренування №${session.sessionNumber}`
      );
    }
  }

  await ctx.reply(formatWorkout(session), { parse_mode: "HTML" });
}

// ── /session ──────────────────────────────────────────────────────────────────

async function sessionHandler(ctx: MyContext) {
  const pkg = await prisma.package.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!pkg) {
    await ctx.reply("Немає активного пакету.");
    return;
  }

  const completedCount = await prisma.session.count({
    where: {
      packageId: pkg.id,
      status: "CONFIRMED",
    },
  });

  const remaining = pkg.totalSessions - completedCount;
  const paymentLine =
    pkg.paymentStatus === "PAID"
      ? "💳 Оплачено"
      : `⚠️ Не оплачено`;

  await ctx.reply(
    `<b>Поточний пакет</b>\n\n` +
      `Занять: ${completedCount} з ${pkg.totalSessions}\n` +
      `Залишилось: ${remaining}\n` +
      `${paymentLine}`,
    { parse_mode: "HTML" }
  );
}

// ── register ──────────────────────────────────────────────────────────────────

export function registerClientHandlers(bot: Bot<MyContext>) {
  bot.command("today", clientOnly, todayHandler);
  bot.command("session", clientOnly, sessionHandler);
}
