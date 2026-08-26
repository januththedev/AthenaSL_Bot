import type { AthenaBot } from "../bot-types.js";
import { config } from "../config.js";
import { askOpenRouter, chunkText } from "../openrouter.js";
import { incrAskUsage } from "../store.js";
import { isAdmin } from "../middleware/auth.js";
import { personaSystemSuffix } from "./persona.js";
import { SYSTEM_PROMPT as SYSTEM_BASE } from "../openrouter.js";

const USAGE = "Usage: /ask <question> — or reply to a message with /ask.";

export function registerAsk(bot: AthenaBot): void {
  bot.command("ask", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const args = (ctx.match ?? "").trim();

    // In groups, replying to a message turns that message into the question.
    const replied = ctx.msg?.reply_to_message;
    let question = args;
    if (!question && replied) {
      const target = replied.text ?? replied.caption ?? "";
      if (target.length > 0) {
        const who = replied.from?.first_name ?? "Someone";
        question = `${who} asks: ${target}`;
      }
    }
    if (question.length === 0) {
      await ctx.reply(USAGE);
      return;
    }
    if (question.length > 4000) question = question.slice(0, 4000);

    // Per-user daily quota in groups; admins are exempt.
    if (ctx.chat.type !== "private" && !(await isAdmin(ctx))) {
      try {
        const used = await incrAskUsage(ctx.chat.id, ctx.from.id);
        if (used > config.askDailyLimit) {
          await ctx.reply(
            `You've used all ${config.askDailyLimit} of today's /ask questions. Come back tomorrow!`,
          );
          return;
        }
      } catch (err) {
        console.error("ask quota check failed", err);
      }
    }

    const thinking = await ctx.reply("🤔 Thinking…");
    const system = SYSTEM_BASE + personaSystemSuffix(ctx.settings?.persona);
    const result = await askOpenRouter(question, system);
    const answer = result.ok ? result.text : `⚠️ ${result.reason}`;

    const parts = chunkText(answer);
    const first = parts[0] ?? "";
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, first);
    } catch {
      await ctx.reply(first);
    }
    for (const part of parts.slice(1)) {
      await ctx.reply(part);
    }
  });
}
