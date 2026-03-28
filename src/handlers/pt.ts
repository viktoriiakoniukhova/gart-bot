import { Bot, Context, SessionFlavor, InlineKeyboard } from "grammy";
import logger from "../lib/logger.js";
import {
  type Conversation,
  type ConversationFlavor,
  conversations,
  createConversation,
} from "@grammyjs/conversations";
import prisma from "../db/prisma.js";
import { ptOnly } from "../middleware/roleGuard.js";
import { formatWorkout } from "./client.js";

export type MyContext = Context & SessionFlavor<Record<string, never>> & ConversationFlavor;
type MyConversation = Conversation<MyContext>;

// ── /newworkout ──────────────────────────────────────────────────────────────

export async function newWorkoutConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  // Find or create active package
  const pkg = await conversation.external(() =>
    prisma.package.findFirst({ orderBy: { createdAt: "desc" } })
  );

  if (!pkg) {
    await ctx.reply(
      "Немає активного пакету. Спочатку створи пакет командою /newpackage."
    );
    return;
  }

  // Determine next session number
  const lastSession = await conversation.external(() =>
    prisma.session.findFirst({
      where: { packageId: pkg.id },
      orderBy: { sessionNumber: "desc" },
    })
  );
  const sessionNumber = (lastSession?.sessionNumber ?? 0) + 1;

  // Scheduled date = today
  const scheduledDate = new Date();
  scheduledDate.setHours(0, 0, 0, 0);

  // Step 1: warm-up
  const warmupKeyboard = new InlineKeyboard()
    .text("Так", "warmup_yes")
    .text("Ні", "warmup_no");

  await ctx.reply(`🏋️ Нове тренування — заняття №${sessionNumber}\n\nДодати розминку?`, {
    reply_markup: warmupKeyboard,
  });

  const warmupCbCtx = await conversation.waitForCallbackQuery([
    "warmup_yes",
    "warmup_no",
  ]);
  await warmupCbCtx.answerCallbackQuery();
  const hasWarmup = warmupCbCtx.callbackQuery.data === "warmup_yes";
  await warmupCbCtx.editMessageText(
    `Розминка: ${hasWarmup ? "✅ Так" : "❌ Ні"}`
  );

  // Step 2: collect exercises
  const exercises: {
    section: string;
    name: string;
    sets: number;
    reps: string;
    load: string;
    weightKg?: number;
  }[] = [];

  let addingExercises = true;
  let orderIndex = 0;

  await ctx.reply(
    "Додай вправи. Введи назву вправи або /done щоб завершити.\n\nПоточна секція: Основна частина"
  );

  let currentSection = "Основна частина";

  while (addingExercises) {
    const nameCtx = await conversation.waitFor("message:text");
    const nameText = nameCtx.message.text.trim();

    if (nameText === "/done") {
      addingExercises = false;
      break;
    }

    if (nameText.startsWith("/section ")) {
      currentSection = nameText.slice(9).trim();
      await nameCtx.reply(`Секція змінена на: "${currentSection}"`);
      continue;
    }

    const exerciseName = nameText;

    // Sets
    await nameCtx.reply(`Підходи для "${exerciseName}":`);
    const setsCtx = await conversation.waitFor("message:text");
    const sets = parseInt(setsCtx.message.text.trim(), 10);
    if (isNaN(sets)) {
      await setsCtx.reply("Невірне число. Пропускаю вправу.");
      continue;
    }

    // Reps
    await setsCtx.reply(`Повторення (напр. "15" або "30с на кожну сторону"):`);
    const repsCtx = await conversation.waitFor("message:text");
    const reps = repsCtx.message.text.trim();

    // Load
    await repsCtx.reply(`Навантаження (напр. "18.2кг" або "гумка"):`);
    const loadCtx = await conversation.waitFor("message:text");
    const load = loadCtx.message.text.trim();

    // Optional numeric weight hint
    const weightMatch = load.match(/(\d+([.,]\d+)?)\s*кг/);
    const weightKg = weightMatch
      ? parseFloat(weightMatch[1].replace(",", "."))
      : undefined;

    exercises.push({
      section: currentSection,
      name: exerciseName,
      sets,
      reps,
      load,
      weightKg,
    });
    orderIndex++;

    await loadCtx.reply(
      `✅ "${exerciseName}" додано. Ще вправа або /done щоб завершити:`
    );
  }

  if (exercises.length === 0) {
    await ctx.reply("Не додано жодної вправи. Тренування скасовано.");
    return;
  }

  // Step 3: optional notes
  const notesKeyboard = new InlineKeyboard()
    .text("Додати нотатки", "notes_yes")
    .text("Пропустити", "notes_no");

  await ctx.reply("Додати нотатки до тренування?", {
    reply_markup: notesKeyboard,
  });

  const notesCbCtx = await conversation.waitForCallbackQuery([
    "notes_yes",
    "notes_no",
  ]);
  await notesCbCtx.answerCallbackQuery();

  let workoutNotes: string | undefined;
  if (notesCbCtx.callbackQuery.data === "notes_yes") {
    await notesCbCtx.editMessageText("Введи нотатки:");
    const notesCtx = await conversation.waitFor("message:text");
    workoutNotes = notesCtx.message.text.trim();
  } else {
    await notesCbCtx.editMessageText("Нотатки: пропущено");
  }

  // Step 4: confirm
  const preview = buildPreview(
    sessionNumber,
    hasWarmup,
    exercises,
    workoutNotes
  );
  const confirmKeyboard = new InlineKeyboard()
    .text("✅ Зберегти", "confirm_save")
    .text("❌ Скасувати", "confirm_cancel");

  await ctx.reply(`Перевір тренування:\n\n${preview}`, {
    reply_markup: confirmKeyboard,
    parse_mode: "HTML",
  });

  const confirmCtx = await conversation.waitForCallbackQuery([
    "confirm_save",
    "confirm_cancel",
  ]);
  await confirmCtx.answerCallbackQuery();

  if (confirmCtx.callbackQuery.data === "confirm_cancel") {
    await confirmCtx.editMessageText("Тренування скасовано.");
    return;
  }

  // Save to DB
  await conversation.external(async () => {
    const session = await prisma.session.create({
      data: {
        packageId: pkg.id,
        sessionNumber,
        scheduledDate,
        status: "WORKOUT_CREATED",
        hasWarmup,
        workoutNotes,
      },
    });

    await prisma.exercise.createMany({
      data: exercises.map((ex, i) => ({
        sessionId: session.id,
        orderIndex: i,
        section: ex.section,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        load: ex.load,
        weightKg: ex.weightKg ?? null,
      })),
    });

    logger.info(
      { sessionId: session.id, sessionNumber, exerciseCount: exercises.length, ptId: ctx.from?.id },
      `workout created: session #${sessionNumber} with ${exercises.length} exercises`
    );
  });

  await confirmCtx.editMessageText(
    `✅ Тренування №${sessionNumber} збережено! Буде доставлено клієнту о 7:30.`
  );
}

function buildPreview(
  sessionNumber: number,
  hasWarmup: boolean,
  exercises: { section: string; name: string; sets: number; reps: string; load: string }[],
  notes?: string
): string {
  let text = `<b>Тренування №${sessionNumber}</b>\n`;
  if (hasWarmup) text += "🔥 Розминка включена\n";
  text += "\n";

  let currentSection = "";
  for (const ex of exercises) {
    if (ex.section !== currentSection) {
      currentSection = ex.section;
      text += `<b>${currentSection}</b>\n`;
    }
    text += `• ${ex.name} — ${ex.sets}×${ex.reps}, ${ex.load}\n`;
  }

  if (notes) text += `\n📝 ${notes}`;
  return text;
}

// ── /history ─────────────────────────────────────────────────────────────────

async function historyHandler(ctx: MyContext) {
  const sessions = await prisma.session.findMany({
    orderBy: { sessionNumber: "desc" },
    take: 10,
    include: { exercises: { orderBy: { orderIndex: "asc" } } },
  });

  if (sessions.length === 0) {
    await ctx.reply("Немає збережених тренувань.");
    return;
  }

  const lines = sessions.map((s) => {
    const date = s.scheduledDate.toLocaleDateString("uk-UA");
    const status =
      s.status === "DELIVERED" || s.status === "CONFIRMED" ? "✅" : "📝";
    return `${status} Заняття №${s.sessionNumber} — ${date} (${s.exercises.length} вправ)`;
  });

  await ctx.reply(`<b>Останні тренування:</b>\n\n${lines.join("\n")}`, {
    parse_mode: "HTML",
  });
}

// ── /clone ────────────────────────────────────────────────────────────────────

export async function cloneConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  const sessions = await conversation.external(() =>
    prisma.session.findMany({
      orderBy: { sessionNumber: "desc" },
      take: 5,
      include: { exercises: { orderBy: { orderIndex: "asc" } } },
    })
  );

  if (sessions.length === 0) {
    await ctx.reply("Немає тренувань для клонування.");
    return;
  }

  const keyboard = new InlineKeyboard();
  for (const s of sessions) {
    const date = s.scheduledDate.toLocaleDateString("uk-UA");
    keyboard.text(`№${s.sessionNumber} — ${date}`, `clone_${s.id}`).row();
  }

  await ctx.reply("Вибери тренування для клонування:", {
    reply_markup: keyboard,
  });

  const cbCtx = await conversation.waitForCallbackQuery(/^clone_/);
  await cbCtx.answerCallbackQuery();

  const sourceId = cbCtx.callbackQuery.data.replace("clone_", "");
  const source = sessions.find((s) => s.id === sourceId);

  if (!source) {
    await cbCtx.editMessageText("Не знайдено.");
    return;
  }

  const pkg = await conversation.external(() =>
    prisma.package.findFirst({ orderBy: { createdAt: "desc" } })
  );

  if (!pkg) {
    await cbCtx.editMessageText("Немає активного пакету.");
    return;
  }

  const lastSession = await conversation.external(() =>
    prisma.session.findFirst({
      where: { packageId: pkg.id },
      orderBy: { sessionNumber: "desc" },
    })
  );
  const sessionNumber = (lastSession?.sessionNumber ?? 0) + 1;
  const scheduledDate = new Date();
  scheduledDate.setHours(0, 0, 0, 0);

  await conversation.external(async () => {
    const newSession = await prisma.session.create({
      data: {
        packageId: pkg.id,
        sessionNumber,
        scheduledDate,
        status: "WORKOUT_CREATED",
        hasWarmup: source.hasWarmup,
        workoutNotes: source.workoutNotes,
      },
    });

    await prisma.exercise.createMany({
      data: source.exercises.map((ex) => ({
        sessionId: newSession.id,
        orderIndex: ex.orderIndex,
        section: ex.section,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        load: ex.load,
        weightKg: ex.weightKg,
      })),
    });

    logger.info(
      { sessionId: newSession.id, sessionNumber, clonedFromSession: source.sessionNumber, ptId: ctx.from?.id },
      `workout cloned: session #${source.sessionNumber} → #${sessionNumber}`
    );
  });

  await cbCtx.editMessageText(
    `✅ Тренування №${source.sessionNumber} клоновано як заняття №${sessionNumber}. Можеш редагувати через /newworkout або доставити о 7:30.`
  );
}

// ── /newpackage ───────────────────────────────────────────────────────────────

async function newPackageConversation(
  conversation: MyConversation,
  ctx: MyContext
) {
  await ctx.reply("Скільки занять у пакеті? (наприклад: 12)");

  let totalSessions: number | undefined;
  while (!totalSessions) {
    const msg = await conversation.waitFor("message:text");
    const n = parseInt(msg.message.text.trim(), 10);
    if (isNaN(n) || n <= 0) {
      await msg.reply("Введи ціле число більше 0:");
    } else {
      totalSessions = n;
    }
  }

  await ctx.reply("Дата початку пакету? (формат: ДД.ММ.РРРР, або /today для сьогодні)");

  let startDate: Date | undefined;
  while (!startDate) {
    const msg = await conversation.waitFor("message:text");
    const text = msg.message.text.trim();
    if (text === "/today") {
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
    } else {
      const [d, m, y] = text.split(".");
      const parsed = new Date(`${y}-${m}-${d}`);
      if (isNaN(parsed.getTime())) {
        await msg.reply("Невірний формат. Спробуй ще раз (ДД.ММ.РРРР):");
      } else {
        startDate = parsed;
      }
    }
  }

  const pkg = await conversation.external(() =>
    prisma.package.create({
      data: {
        totalSessions: totalSessions!,
        startDate: startDate!,
        paymentStatus: "UNPAID",
      },
    })
  );

  logger.info(
    { packageId: pkg.id, totalSessions: pkg.totalSessions, startDate, ptId: ctx.from?.id },
    `package created: ${pkg.totalSessions} sessions starting ${startDate!.toLocaleDateString("uk-UA")}`
  );

  await ctx.reply(
    `✅ Пакет створено!\n\nЗанять: ${pkg.totalSessions}\nПочаток: ${startDate!.toLocaleDateString("uk-UA")}\nОплата: не оплачено`
  );
}

// ── register ──────────────────────────────────────────────────────────────────

export function registerPTHandlers(bot: Bot<MyContext>) {
  bot.use(createConversation(newWorkoutConversation, "newworkout"));
  bot.use(createConversation(cloneConversation, "clone"));
  bot.use(createConversation(newPackageConversation, "newpackage"));

  bot.command("newworkout", ptOnly, (ctx) =>
    ctx.conversation.enter("newworkout")
  );
  bot.command("history", ptOnly, historyHandler);
  bot.command("clone", ptOnly, (ctx) => ctx.conversation.enter("clone"));
  bot.command("newpackage", ptOnly, (ctx) =>
    ctx.conversation.enter("newpackage")
  );
}
