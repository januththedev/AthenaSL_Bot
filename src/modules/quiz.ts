import { InlineKeyboard } from "grammy";
import { adminOnly } from "../middleware/auth.js";
import { askOpenRouter } from "../openrouter.js";
import { kvDel, kvGet, kvSet } from "../store.js";
import { escapeHtml } from "../utils.js";
import type { AthenaBot } from "../bot-types.js";

export interface QuizQuestion {
  question: string;
  options: string[];
  /** 0-3 index into options */
  answer: number;
}

export interface QuizSession {
  topic: string;
  questions: QuizQuestion[];
  idx: number;
  scores: Record<string, { name: string; correct: number; answered: number }>;
}

const LETTERS = ["A", "B", "C", "D"] as const;

/**
 * Extract and validate a quiz from raw model output. Returns null when the
 * output is unusable. Pure.
 */
export function parseQuiz(raw: string): QuizQuestion[] | null {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  let arr: unknown;
  try {
    arr = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(arr) || arr.length < 3 || arr.length > 10) return null;
  const out: QuizQuestion[] = [];
  for (const item of arr) {
    const q = item as Record<string, unknown>;
    const question = typeof q["question"] === "string" ? q["question"].trim() : "";
    const options = Array.isArray(q["options"])
      ? q["options"].filter((o): o is string => typeof o === "string" && o.trim().length > 0)
      : [];
    const answer = typeof q["answer"] === "number" ? q["answer"] : -1;
    if (
      question.length === 0 ||
      options.length !== 4 ||
      !Number.isInteger(answer) ||
      answer < 0 ||
      answer > 3
    ) {
      return null;
    }
    out.push({ question, options: options.map((o) => o.trim()), answer });
  }
  return out.length >= 3 ? out : null;
}

function quizPrompt(topic: string): string {
  return (
    `Create a multiple-choice quiz for students on the topic: "${topic}".\n` +
    "Return ONLY a JSON array of exactly 5 objects, no markdown, no commentary. " +
    "Each object: {\"question\": string, \"options\": [exactly 4 short strings], \"answer\": index 0-3 of the correct option}. " +
    "Difficulty: high-school level. Only one option may be correct; distractors must be plausible."
  );
}

function questionKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text("A", "qa:0").text("B", "qa:1").row();
  kb.text("C", "qa:2").text("D", "qa:3");
  return kb;
}

async function sendQuestion(bot: AthenaBot, chatId: number, s: QuizSession): Promise<void> {
  const q = s.questions[s.idx];
  if (!q) return;
  const lines = q.options.map((o, i) => `${LETTERS[i]}. ${o}`);
  await bot.api.sendMessage(
    chatId,
    `🧠 Quiz: <b>${escapeHtml(s.topic)}</b> — question ${s.idx + 1}/${s.questions.length}\n\n${escapeHtml(q.question)}\n\n${escapeHtml(lines.join("\n"))}`,
    { parse_mode: "HTML", reply_markup: questionKeyboard() },
  );
}

export function registerQuiz(bot: AthenaBot): void {
  bot.command("quiz", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const topic = (ctx.match ?? "").trim();
    if (topic.length === 0 || topic.length > 80) {
      await ctx.reply("Usage: /quiz <topic> — e.g. /quiz photosynthesis, /quiz quadratic equations");
      return;
    }
    const activeKey = `quiz:${ctx.chat.id}:active`;
    if (await kvGet<QuizSession>(activeKey)) {
      await ctx.reply("A quiz is already running — finish it first (or /quizstop).");
      return;
    }

    const thinking = await ctx.reply(`🧮 Writing a quiz on “${topic}”…`);
    const res = await askOpenRouter(quizPrompt(topic));
    if (!res.ok) {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ ${res.reason}`);
      return;
    }
    const questions = parseQuiz(res.text);
    if (!questions) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        thinking.message_id,
        "⚠️ The model returned a malformed quiz. Try again, or pick a more specific topic.",
      );
      return;
    }
    const session: QuizSession = { topic, questions, idx: 0, scores: {} };
    await kvSet(activeKey, session, 3600);
    await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    await sendQuestion(bot, ctx.chat.id, session);
  });

  bot.command(["quizstop", "quizend"], adminOnly(async (ctx) => {
    if (!ctx.chat) return;
    const deleted = await kvDel(`quiz:${ctx.chat.id}:active`);
    await ctx.reply(deleted > 0 ? "Quiz ended." : "No quiz is running.");
  }));

  bot.callbackQuery(/^qa:(\d)$/, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const activeKey = `quiz:${ctx.chat.id}:active`;
    const session = await kvGet<QuizSession>(activeKey);
    if (!session) {
      await ctx.answerCallbackQuery({ text: "This quiz has ended." });
      return;
    }
    const q = session.questions[session.idx];
    if (!q) {
      await ctx.answerCallbackQuery({ text: "Question unavailable." });
      return;
    }
    const picked = Number(ctx.match?.[1] ?? -1);
    const me = String(ctx.from.id);
    if (session.scores[me] && session.scores[me]!.answered > session.idx) {
      await ctx.answerCallbackQuery({ text: "You already answered this one!" });
      return;
    }
    const correct = picked === q.answer;
    const prev = session.scores[me] ?? { name: ctx.from.first_name ?? "player", correct: 0, answered: 0 };
    session.scores[me] = {
      name: ctx.from.first_name ?? "player",
      correct: prev.correct + (correct ? 1 : 0),
      answered: session.idx + 1,
    };

    const answerLetter = LETTERS[q.answer] ?? "?";
    if (session.idx + 1 >= session.questions.length) {
      await kvDel(activeKey);
      await ctx.answerCallbackQuery({ text: correct ? "✅ Correct!" : `❌ It was ${answerLetter}.` });
      const board = Object.values(session.scores)
        .sort((a, b) => b.correct - a.correct)
        .map((s, i) => `${["🥇", "🥈", "🥉"][i] ?? "•"} ${s.name}: ${s.correct}/${session.questions.length}`);
      await ctx.editMessageText(
        `🏁 Quiz “${escapeHtml(session.topic)}” finished!\nCorrect answer: ${answerLetter}\n\n${board.join("\n")}`,
        { parse_mode: "HTML" },
      );
      return;
    }

    session.idx += 1;
    await kvSet(activeKey, session, 3600);
    await ctx.answerCallbackQuery({ text: correct ? "✅ Correct!" : `❌ It was ${answerLetter}.` });
    await sendQuestion(bot, ctx.chat.id, session);
  });
}
