import { InlineKeyboard } from "grammy";
import type { User } from "grammy/types";
import { adminOnly, isAdmin } from "../middleware/auth.js";
import {
  addWarn,
  clearWarns,
  getWarns,
  removeWarn,
  type WarnAction,
} from "../store.js";
import { escapeHtml, groupContext, targetUser } from "../utils.js";
import type { AthenaBot } from "../bot-types.js";

function nameOf(u: User): string {
  return `${u.first_name}${u.last_name ? " " + u.last_name : ""}`.trim() || "user";
}

async function applyWarnAction(
  bot: AthenaBot,
  chatId: number,
  userId: number,
  action: WarnAction,
  muteMinutes: number,
): Promise<{ applied: boolean; detail: string }> {
  try {
    if (action === "ban") {
      await bot.api.banChatMember(chatId, userId);
    } else if (action === "kick") {
      await bot.api.banChatMember(chatId, userId);
      await bot.api.unbanChatMember(chatId, userId, { only_if_banned: true });
    } else {
      const until = Math.floor(Date.now() / 1000) + muteMinutes * 60;
      await bot.api.restrictChatMember(chatId, userId, { can_send_messages: false }, { until_date: until });
    }
    return { applied: true, detail: action };
  } catch (err) {
    console.error("warn action failed (needs can_restrict_members)", err);
    return { applied: false, detail: action };
  }
}

export function registerWarns(bot: AthenaBot): void {
  bot.command("warn", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g || !ctx.from) return;
    const t = targetUser(ctx);
    if (!t || t.source !== "reply" || t.user.id === ctx.from.id) {
      await ctx.reply("Usage: reply to a message with /warn <reason>.");
      return;
    }
    const reason = (ctx.match ?? "").trim() || "No reason given";
    const count = await addWarn(g.chatId, t.user.id, {
      reason,
      by: ctx.from.first_name || "admin",
      at: Date.now(),
    });
    const limit = g.settings.warnLimit;

    let text =
      `⚠️ <a href="tg://user?id=${t.user.id}">${escapeHtml(nameOf(t.user))}</a> was warned.` +
      `\nReason: ${escapeHtml(reason)}\nWarnings: <b>${count}/${limit}</b>`;

    if (count >= limit) {
      const res = await applyWarnAction(bot, g.chatId, t.user.id, g.settings.warnAction, 60);
      text += res.applied
        ? `\n🚫 Warning limit reached — user ${res.detail === "mute" ? "muted for 1 hour" : res.detail + "ned"}.`
        : `\n⚠️ Limit reached, but I lack permission to ${res.detail}. Promote me with "Ban users" rights.`;
      await clearWarns(g.chatId, t.user.id);
      await ctx.reply(text, { parse_mode: "HTML" });
      return;
    }

    const keyboard = new InlineKeyboard().text("➖ Remove warning", `warnrm:${t.user.id}`);
    await ctx.reply(text, { parse_mode: "HTML", reply_markup: keyboard });
  }));

  bot.callbackQuery(/^warnrm:(-?\d+)$/, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (!(await isAdmin(ctx))) {
      await ctx.answerCallbackQuery({ text: "Admins only." });
      return;
    }
    const uid = Number.parseInt(ctx.match![1] ?? "0", 10);
    const warns = await getWarns(ctx.chat.id, uid);
    if (warns.length === 0) {
      await ctx.answerCallbackQuery({ text: "No warnings left to remove." });
      return;
    }
    await removeWarn(ctx.chat.id, uid, warns.length - 1);
    await ctx.answerCallbackQuery({ text: "Warning removed." });
    try {
      const msgText = ctx.update.callback_query.message?.text ?? "";
      await ctx.editMessageText(
        `${msgText}\n\n✅ Last warning removed by ${escapeHtml(ctx.from.first_name ?? "admin")}.`,
      );
    } catch {
      // message may be too old to edit; the callback answer already informed the admin
    }
  });

  bot.command("warnings", async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const t = targetUser(ctx);
    if (!t) return;
    const warns = await getWarns(g.chatId, t.user.id);
    if (t.user.id === ctx.from?.id && warns.length === 0) {
      await ctx.reply("You have no warnings. Keep it up! ✨");
      return;
    }
    if (warns.length === 0) {
      await ctx.reply(`${nameOf(t.user)} has no warnings.`);
      return;
    }
    const lines = warns.map(
      (w, i) => `${i + 1}. ${escapeHtml(w.reason)} — by ${escapeHtml(w.by)} (${new Date(w.at).toISOString().slice(0, 10)})`,
    );
    await ctx.reply(
      `Warnings for <a href="tg://user?id=${t.user.id}">${escapeHtml(nameOf(t.user))}</a>:\n${lines.join("\n")}`,
      { parse_mode: "HTML" },
    );
  });

  bot.command("resetwarn", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const t = targetUser(ctx);
    if (!t) return;
    await clearWarns(g.chatId, t.user.id);
    await ctx.reply(`♻️ Warnings cleared for ${nameOf(t.user)}.`);
  }));

  bot.command(["warnlimit", "setwarnlimit"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const n = Number.parseInt((ctx.match ?? "").trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 100) {
      await ctx.reply(`Usage: /warnlimit <1-100> (current: ${g.settings.warnLimit})`);
      return;
    }
    g.settings.warnLimit = n;
    await ctx.reply(`Users will now be acted on after ${n} warnings.`);
  }));

  bot.command(["warnaction", "setwarnaction"], adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg !== "ban" && arg !== "kick" && arg !== "mute") {
      await ctx.reply(
        `Usage: /warnaction <ban|kick|mute>\nCurrent action on limit: ${g.settings.warnAction}`,
      );
      return;
    }
    g.settings.warnAction = arg;
    await ctx.reply(`On reaching the warning limit, users will now be ${arg === "mute" ? "muted for 1 hour" : arg + "ned"}.`);
  }));
}
