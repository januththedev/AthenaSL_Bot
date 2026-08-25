import { getAdminIds, isAdmin } from "../middleware/auth.js";
import { escapeHtml } from "../utils.js";
import { getWarns } from "../store.js";
import type { AthenaBot } from "../bot-types.js";
import type { User } from "grammy/types";

function nameOf(u: User): string {
  return `${u.first_name}${u.last_name ? " " + u.last_name : ""}`.trim() || "user";
}

export function registerInfo(bot: AthenaBot): void {
  bot.command("id", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const lines = [`Chat ID: <code>${ctx.chat.id}</code>`, `Your ID: <code>${ctx.from.id}</code>`];
    const replied = ctx.msg?.reply_to_message?.from;
    if (replied && replied.id !== ctx.me.id) {
      lines.push(`Replied user: <a href="tg://user?id=${replied.id}">${escapeHtml(nameOf(replied))}</a> (<code>${replied.id}</code>)`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command("admins", async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
    const ids = await getAdminIds(ctx, ctx.chat.id);
    const members = await Promise.all(
      [...ids].map((id) => ctx.api.getChatMember(ctx.chat!.id, id).catch(() => null)),
    );
    const lines = members
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) =>
        m.user.username
          ? `• @${m.user.username} (${m.status})`
          : `• <a href="tg://user?id=${m.user.id}">${escapeHtml(nameOf(m.user))}</a> (${m.status})`,
      );
    await ctx.reply(`👑 Admins:\n${lines.join("\n")}`, { parse_mode: "HTML" });
  });

  bot.command("info", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") {
      await ctx.reply("/info works in groups.");
      return;
    }

    // Resolve target: reply > @username/id argument > self.
    let user: User | undefined = ctx.msg?.reply_to_message?.from;
    const arg = (ctx.match ?? "").trim();
    if (!user && arg.length > 0) {
      const asId = Number.parseInt(arg.replace(/^@/, ""), 10);
      try {
        const peer = Number.isFinite(asId)
          ? await ctx.api.getChat(asId)
          : await ctx.api.getChat(arg.startsWith("@") ? arg : `@${arg}`);
        // getChat returns a chat-shaped object; rebuild the User fields we display.
        if (peer && "first_name" in peer) {
          user = {
            id: peer.id,
            is_bot: false,
            first_name: peer.first_name ?? "Unknown",
            last_name: "last_name" in peer ? (peer.last_name ?? "") : "",
            username: "username" in peer ? peer.username : undefined,
          };
        }
      } catch {
        await ctx.reply("Couldn't resolve that user — reply to one of their messages instead.");
        return;
      }
    }
    if (!user) user = ctx.from;

    let status = "member";
    let warns = 0;
    try {
      const member = await ctx.api.getChatMember(ctx.chat.id, user.id);
      status = member.status === "creator" ? "owner 👑" : member.status;
    } catch {
      // keep defaults
    }
    warns = (await getWarns(ctx.chat.id, user.id)).length;
    const adminNow = await isAdmin(ctx, user.id);

    await ctx.reply(
      `<b>${escapeHtml(nameOf(user))}</b>\n` +
        `ID: <code>${user.id}</code>\n` +
        (user.username ? `Username: @${user.username}\n` : "") +
        `Status: ${adminNow ? "admin ⚡" : status}\n` +
        `Warnings: ${warns}`,
      { parse_mode: "HTML" },
    );
  });
}
