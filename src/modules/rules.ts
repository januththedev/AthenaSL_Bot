import { adminOnly } from "../middleware/auth.js";
import { escapeHtml, groupContext } from "../utils.js";
import type { AthenaBot } from "../bot-types.js";

export function registerRules(bot: AthenaBot): void {
  bot.command("rules", async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    if (!g.settings.rules) {
      await ctx.reply("No rules have been set for this group yet.");
      return;
    }
    await ctx.reply(`📜 <b>Rules</b>\n${escapeHtml(g.settings.rules)}`, { parse_mode: "HTML" });
  });

  bot.command(["setrules"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const text = (ctx.match ?? "").trim();
    if (text.length === 0) {
      await ctx.reply(
        "Usage: /setrules <text> — everything after the command becomes the rules. Multi-line works.",
      );
      return;
    }
    if (text.length > 3500) {
      await ctx.reply("Rules too long (max ~3500 characters).");
      return;
    }
    g.settings.rules = text;
    await ctx.reply("📜 Rules saved. Members can view them with /rules.");
  }));

  bot.command(["clearrules", "resetrules"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    g.settings.rules = null;
    await ctx.reply("Rules cleared.");
  }));
}
