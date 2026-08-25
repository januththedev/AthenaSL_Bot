import { adminOnly } from "../middleware/auth.js";
import { groupContext } from "../utils.js";
import { floodBucketWindowSeconds } from "../store.js";
import type { AthenaBot } from "../bot-types.js";

export function registerFloodCommands(bot: AthenaBot): void {
  bot.command("antiflood", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    const cfg = g.settings.antiflood;

    if (arg === "on" || arg === "yes" || arg === "enable") {
      cfg.on = true;
      await ctx.reply(
        `🌊 Antiflood enabled: more than ${cfg.limit} messages per ${floodBucketWindowSeconds()}s → ${cfg.muteMinutes} min mute.`,
      );
      return;
    }
    if (arg === "off" || arg === "no" || arg === "disable") {
      cfg.on = false;
      await ctx.reply("Antiflood disabled.");
      return;
    }
    const n = Number.parseInt(arg, 10);
    if (Number.isFinite(n) && n >= 3 && n <= 50) {
      cfg.limit = n;
      cfg.on = true;
      await ctx.reply(
        `🌊 Antiflood enabled: more than ${n} messages per ${floodBucketWindowSeconds()}s → ${cfg.muteMinutes} min mute.`,
      );
      return;
    }
    await ctx.reply(
      `Antiflood is currently ${cfg.on ? `ON (limit ${cfg.limit}/${floodBucketWindowSeconds()}s, ${cfg.muteMinutes} min mute)` : "OFF"}.\n` +
        "Usage: /antiflood on|off|<limit 3-50>",
    );
  }));
}
