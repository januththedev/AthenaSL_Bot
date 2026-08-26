import { adminOnly } from "../middleware/auth.js";
import { escapeHtml, groupContext } from "../utils.js";
import type { AthenaBot } from "../bot-types.js";

export const PERSONA_LIMIT = 800;

/**
 * Per-group customization of /ask answers: admins store free-form
 * instructions that get appended to the global system prompt for
 * THIS chat only.
 */
export function personaSystemSuffix(persona: string | null | undefined): string {
  if (!persona || persona.trim().length === 0) return "";
  return (
    "\n\nGROUP CUSTOM STYLE — the admins of this group set the following instructions. " +
    "Follow them for tone, format, curriculum and language, but never break the ACCURACY RULES above.\n" +
    persona.trim()
  );
}

export function registerPersona(bot: AthenaBot): void {
  bot.command(["setpersona", "setstyle"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const text = (ctx.match ?? "").trim();
    if (text.length === 0) {
      await ctx.reply(
        `Usage: /setpersona <instructions>\nExample: /setpersona Answer in Sinhala first, then English. Focus on A/L biology. Always end with one exam-style practice question.`,
      );
      return;
    }
    if (text.length > PERSONA_LIMIT) {
      await ctx.reply(`Too long — max ${PERSONA_LIMIT} characters (you sent ${text.length}).`);
      return;
    }
    g.settings.persona = text;
    await ctx.reply(
      `🎨 Custom style saved for THIS group only.\n\n${escapeHtml(text)}`,
      { parse_mode: "HTML" },
    );
  }));

  bot.command(["persona", "style"], async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    await ctx.reply(
      g.settings.persona
        ? `🎨 This group's custom /ask style:\n\n${escapeHtml(g.settings.persona)}`
        : "This group uses the default Athena style. Admins can customize it with /setpersona <instructions>.",
      { parse_mode: "HTML" },
    );
  });

  bot.command(["resetpersona", "resetstyle"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    g.settings.persona = null;
    await ctx.reply("Custom style removed — /ask is back to the default Athena style.");
  }));
}
