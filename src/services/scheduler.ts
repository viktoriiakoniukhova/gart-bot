import cron from "node-cron";
import type { Api } from "grammy";
import prisma from "../db/prisma.js";
import { formatWorkout } from "../handlers/client.js";

const PT_ID = Number(process.env.PT_TELEGRAM_ID);
const CLIENT_ID = Number(process.env.CLIENT_TELEGRAM_ID);

// Training days: Monday=1, Wednesday=3, Friday=5
const TRAINING_DAYS = new Set([1, 3, 5]);

function isTrainingDay(date: Date = new Date()): boolean {
  return TRAINING_DAYS.has(date.getDay());
}

// 7:30am — deliver workout to client
async function deliverWorkout(api: Api) {
  if (!isTrainingDay()) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const session = await prisma.session.findFirst({
    where: {
      scheduledDate: { gte: today, lt: tomorrow },
      status: "WORKOUT_CREATED",
    },
    include: { exercises: { orderBy: { orderIndex: "asc" } } },
  });

  if (!session) {
    // No workout ready — notify PT
    await api.sendMessage(
      PT_ID,
      "⚠️ Сьогодні тренувальний день, але тренування не збережено!\nДодай через /newworkout або /clone."
    );
    return;
  }

  const message = formatWorkout(session);
  await api.sendMessage(CLIENT_ID, message, { parse_mode: "HTML" });

  await prisma.session.update({
    where: { id: session.id },
    data: { status: "DELIVERED", deliveredAt: new Date() },
  });

  await api.sendMessage(
    PT_ID,
    `✅ Тренування №${session.sessionNumber} доставлено клієнту о 7:30.`
  );
}

// 9:00pm the night before a training day — remind PT if no workout saved
async function remindPT(api: Api) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  if (!isTrainingDay(tomorrow)) return;

  const nextDay = new Date(tomorrow);
  nextDay.setDate(nextDay.getDate() + 1);

  const session = await prisma.session.findFirst({
    where: {
      scheduledDate: { gte: tomorrow, lt: nextDay },
      status: { in: ["WORKOUT_CREATED", "DELIVERED", "CONFIRMED"] },
    },
  });

  if (!session) {
    await api.sendMessage(
      PT_ID,
      "⏰ Нагадування: завтра тренувальний день, але тренування ще не збережено.\nДодай через /newworkout або /clone."
    );
  }
}

export function startScheduler(api: Api) {
  // 7:30am every day — delivers if training day
  cron.schedule("30 7 * * *", () => {
    deliverWorkout(api).catch((err) =>
      console.error("Scheduler deliverWorkout error:", err)
    );
  });

  // 9:00pm every day — checks if tomorrow is training day
  cron.schedule("0 21 * * *", () => {
    remindPT(api).catch((err) =>
      console.error("Scheduler remindPT error:", err)
    );
  });

  console.log("Scheduler started: 7:30 delivery + 21:00 PT reminder");
}
