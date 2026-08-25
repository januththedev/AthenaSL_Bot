import type { CommandContext } from "grammy";
import { adminOnly, canDelete } from "../middleware/auth.js";
import { groupContext } from "../utils.js";
import type { AthenaBot } from "../bot-types.js";
import type { AthenaContext } from "../context.js";

const MAX_PURGE_RANGE = 200;

async function deleteQuietly(api: AthenaBot["api"], chatId: number, messageId: number): Promise<boolean> {
  try {
    await api.deleteMessage(chatId, messageId);
    return true;
  } catch {
    return false;
  }
}

export function registerPurge(bot: AthenaBot): void {
  // /del — remove the message you replied to (plus your command).
  bot.command("del", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    if (!(await canDelete(ctx))) {
      await ctx.reply('I need the "Delete messages" admin right.');
      return;
    }
    const replied = ctx.msg?.reply_to_message;
    if (!replied || !ctx.msg) {
      await ctx.reply("Reply to a message with /del to delete it.");
      return;
    }
    let n = 0;
    if (await deleteQuietly(bot.api, g.chatId, replied.message_id)) n++;
    await deleteQuietly(bot.api, g.chatId, ctx.msg.message_id);
    if (n === 0) await ctx.reply("Could not delete that (too old, or already gone).");
  }));

  const purgeRange = async (ctx: CommandContext<AthenaContext>, silent: boolean) => {
    const g = await groupContext(ctx);
    if (!g) return;
    if (!(await canDelete(ctx))) {
      await ctx.reply('I need the "Delete messages" admin right.');
      return;
    }
    const replied = ctx.msg?.reply_to_message;
    if (!replied || !ctx.msg) {
      await ctx.reply("Reply to the oldest message you want gone, then send /purge.");
      return;
    }
    const fromId = Math.max(replied.message_id, ctx.msg.message_id);
    const toId = Math.min(replied.message_id, ctx.msg.message_id);
    if (fromId - toId + 1 > MAX_PURGE_RANGE) {
      await ctx.reply(`That range is too large (max ${MAX_PURGE_RANGE} messages).`);
      return;
    }
    let deleted = 0;
    for (let id = toId; id <= fromId; id++) {
      if (await deleteQuietly(bot.api, g.chatId, id)) deleted++;
    }
    if (silent) return;
    const note = await ctx.reply(`🧹 Deleted ${deleted} message${deleted === 1 ? "" : "s"}.`);
    setTimeout(() => {
      deleteQuietly(bot.api, g.chatId, note.message_id).catch(() => {});
    }, 5000);
  };

  bot.command("purge", adminOnly(async (ctx) => purgeRange(ctx, false)));
  bot.command("spurge", adminOnly(async (ctx) => purgeRange(ctx, true)));
}
