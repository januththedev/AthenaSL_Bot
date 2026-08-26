import type { AthenaBot } from "../bot-types.js";
import { config } from "../config.js";
import { askOpenRouter } from "../openrouter.js";
import type { AskResult } from "../openrouter.js";
import { incrAskUsage } from "../store.js";
import { isAdmin } from "../middleware/auth.js";
import { chunkText } from "../utils.js";
import { personaSystemSuffix } from "./persona.js";
import { extractChartMarker } from "./charts.js";
import { renderChartPng } from "./charts.js";
import { routeDecision, ROUTE_INSTRUCTION, PYTHON_GROUNDING, detectLanguage, languageAddendum } from "./router.js";
import { askGroq } from "./groq.js";
import { InputFile } from "grammy";
import { SYSTEM_PROMPT as SYSTEM_BASE } from "../openrouter.js";

const USAGE = "Usage: /ask <question> — or reply to a message with /ask.";

/** Appended so numeric answers can end with a CHART:{...} spec we render exactly. */
const CHART_INSTRUCTION =

  "\n\nPRECISE CHARTS: If (and only if) the answer involves numeric comparisons, trends, proportions or rankings, append ONE final line in exactly this format:\n" +
  "CHART:{\"type\":\"bar|line|pie\",\"title\":\"...\",\"unit\":\"...\",\"items\":[{\"label\":\"...\",\"value\":123}]}\n" +
  "Use correct real-world values. 2-8 items. Nothing after that line. Omit it entirely when a chart wouldn't help.";

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

    // Automatic routing: questions needing fresh web facts or exact
    // computation go straight to Groq's compound model (web search + python
    // execution). Sinhala/Tamil questions (incl. Singlish/Tanglish) also go
    // to Groq — it handles them far better than the free OpenRouter models.
    const route = routeDecision(question);
    const lang = detectLanguage(question);
    const langNote = languageAddendum(lang);
    const routed = route !== "auto" || lang !== "en";
    const thinking = await ctx.reply(routed ? "🛰️ Working on it (with tools)…" : "🤔 Thinking…");
    const persona = personaSystemSuffix(ctx.settings?.persona);
    const system = SYSTEM_BASE + CHART_INSTRUCTION + ROUTE_INSTRUCTION + persona + (langNote ?? "");

    let result: AskResult;
    if (routed) {
      const grounded =
        route === "python"
          ? SYSTEM_BASE + (langNote ?? "") + PYTHON_GROUNDING + persona
          : SYSTEM_BASE + (langNote ?? "") + persona;
      result = await askGroq(question, grounded, config.groqCompoundModel);
      if (!result.ok) result = await askOpenRouter(question, system);
    } else {
      result = await askOpenRouter(question, system);
      if (result.ok) {
        // The model itself may request a reroute to tools it doesn't have.
        const marker = /^ROUTE:(web|python)\s*$/im.exec(result.text);
        if (marker) {
          const groqResult = await askGroq(
            question,
            SYSTEM_BASE + (langNote ?? "") + persona,
            config.groqCompoundModel,
          );
          if (groqResult.ok) result = groqResult;
          else {
            result = { ok: true, text: result.text.replace(marker[0], "").trim() };
          }
        }
      }
    }

    if (!result.ok) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ ${result.reason}`);
      } catch {
        await ctx.reply(`⚠️ ${result.reason}`);
      }
      return;
    }

    const { answer, spec } = extractChartMarker(result.text);
    const parts = chunkText(answer.length > 0 ? answer : result.text);
    const first = parts[0] ?? "";
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, first);
    } catch {
      await ctx.reply(first);
    }
    for (const part of parts.slice(1)) {
      await ctx.reply(part);
    }
    if (spec) {
      try {
        const png = await renderChartPng(spec);
        await ctx.replyWithPhoto(new InputFile(png, "chart.png"), {
          caption: `📊 ${spec.title}`,
        });
      } catch (err) {
        console.error("auto-chart render failed", err);
      }
    }
  });
}
