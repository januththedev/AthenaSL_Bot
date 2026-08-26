import { adminOnly, getAdminIds } from "../middleware/auth.js";
import { escapeHtml, groupContext } from "../utils.js";
import { BOT_VERSION } from "../config.js";
import type { AthenaBot } from "../bot-types.js";

export const HELP_TEXT = `🤖 <b>Athena — commands</b>

<b>Ask AI</b>
/ask &lt;question&gt; — ask the AI (or reply to a message with /ask)
/setpersona &lt;text&gt; — customize /ask style for THIS group • /persona

<b>Study tools</b>
/remind &lt;1h30m | 18:30 | 2026-09-01&gt; &lt;text&gt; • /reminders • /delremind
/exam &lt;YYYY-MM-DD&gt; &lt;name&gt; — daily countdown • /exams
/quiz &lt;topic&gt; — 5-question MCQ quiz with scoreboard • /quizstop
/summarize (reply) — summarize a long message or a link
/recap — AI recap of today's chat • /resources — links shared

<b>Images &amp; artifacts</b>
/draw &lt;description&gt; — AI-generated image (pollinations.ai)
/artifact &lt;description&gt; — AI builds an SVG image, code file, or Markdown doc and sends it as a file

<b>Moderation (admins)</b>
/warn [reason] — warn (reply) • /warnings • /resetwarn
/warnlimit N — warnings before action • /warnaction ban|kick|mute
/lock &lt;type…&gt; / /unlock &lt;type…&gt; / /locks
  types: photo video animation audio voice videonote sticker document contact location poll url forward inline all bots
/purge — delete everything from the replied message down (also /spurge silent)
/del — delete one replied message
/setrules &lt;text&gt; / /rules / /clearrules
/setwelcome &lt;text&gt; / /welcome on|off / /resetwelcome
/setgoodbye &lt;text&gt; / /goodbye on|off / /resetgoodbye
  fillings: {first} {last} {fullname} {username} {id} {chatname} {count}
/antiflood on|off|N — temp-mute after N messages per 10s
/cleanservice on|off — auto-delete join/leave/pin notices
/pin / /unpin (reply)

<b>Notes</b>
/save &lt;name&gt; — save note (reply or text)
#get name or just #name in chat • /notes • /clear name

<b>Filters (auto-replies)</b>
/filter &lt;keyword&gt; (reply with the response) / /filters / /stop keyword

<b>Info</b>
/info (reply or @user/id) • /id • /admins
/report (reply) — alert the admins`;

export function registerMisc(bot: AthenaBot): void {
  bot.command("start", async (ctx) => {
    if (ctx.chat?.type === "private") {
      await ctx.reply(
        "👋 Hi! I'm <b>Athena</b>, a group-management bot for your study group.\n\n" +
          "Add me to a group and make me an admin, then try <code>/help</code>. " +
          "Students can use <code>/ask &lt;question&gt;</code> to get AI answers.\n\n" +
          '👨‍💻 Built by <a href="https://januth.dev">Januth Nimnal</a>',
        { parse_mode: "HTML" },
      );
    } else {
      await ctx.reply("I'm awake. See /help for what I can do.");
    }
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
  });

  bot.command("about", async (ctx) => {
    await ctx.reply(
      `<b>Athena</b> v${BOT_VERSION}\nGroup management + AI assistant.\n` +
        "TypeScript • grammY • Vercel • Neon Postgres • OpenRouter\n\n" +
        '👨‍💻 Built by <a href="https://januth.dev">Januth Nimnal</a> — <a href="https://januth.dev">januth.dev</a>',
      { parse_mode: "HTML" },
    );
  });

  bot.command("pin", adminOnly(async (ctx) => {
    const replied = ctx.msg?.reply_to_message;
    if (!replied) {
      await ctx.reply("Reply to a message with /pin to pin it.");
      return;
    }
    const arg = (ctx.match ?? "").trim().toLowerCase();
    const silent = arg === "silent" || arg === "quiet";
    try {
      await ctx.pinChatMessage(replied.message_id, { disable_notification: silent });
    } catch {
      await ctx.reply('Could not pin — I need the "Pin messages" admin right.');
    }
  }));

  bot.command("unpin", adminOnly(async (ctx) => {
    const replied = ctx.msg?.reply_to_message;
    if (!replied) {
      await ctx.reply("Reply to a pinned message with /unpin.");
      return;
    }
    try {
      await ctx.unpinChatMessage(replied.message_id);
    } catch {
      await ctx.reply("Could not unpin that message.");
    }
  }));

  bot.command("report", async (ctx) => {
    if (
      !ctx.chat ||
      !ctx.msg ||
      !ctx.from ||
      (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")
    ) {
      return;
    }
    const chatId = ctx.chat.id;
    const replied = ctx.msg.reply_to_message;
    if (!replied || !replied.from) {
      await ctx.reply("Reply to the offending message with /report.");
      return;
    }
    const adminIds = await getAdminIds(ctx, chatId);
    const candidates = [...adminIds].filter(
      (id) => id !== ctx.from!.id && id !== replied.from!.id && id !== ctx.me.id,
    );
    const members = await Promise.all(
      candidates.map((id) => ctx.api.getChatMember(chatId, id).catch(() => null)),
    );
    const mentions = members
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .map((m) =>
        m.user.username
          ? `@${m.user.username}`
          : `<a href="tg://user?id=${m.user.id}">${escapeHtml(m.user.first_name ?? "admin")}</a>`,
      );
    const target = replied.from.username
      ? `@${replied.from.username}`
      : `<a href="tg://user?id=${replied.from.id}">${escapeHtml(replied.from.first_name ?? "someone")}</a>`;
    const body =
      `🚨 ${escapeHtml(ctx.from.first_name ?? "Someone")} reported ${target} to admins.` +
      (mentions.length > 0 ? `\n${mentions.join(" ")}` : "");
    // Send as an in-thread reply so the reported message stays attached.
    await ctx.api.sendMessage(chatId, body, {
      parse_mode: "HTML",
      reply_parameters: { message_id: replied.message_id, allow_sending_without_reply: true },
    });
  });

  bot.command("cleanservice", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const arg = (ctx.match ?? "").trim().toLowerCase();
    if (arg === "on" || arg === "yes" || arg === "enable") {
      g.settings.cleanService = true;
    } else if (arg === "off" || arg === "no" || arg === "disable") {
      g.settings.cleanService = false;
    } else {
      await ctx.reply(
        `Service-message cleanup is currently ${g.settings.cleanService ? "ON" : "OFF"}.\nUsage: /cleanservice on|off`,
      );
      return;
    }
    await ctx.reply(
      g.settings.cleanService
        ? "🧹 Service messages (joins/leaves/pins) will now be deleted."
        : "Service messages will stay visible.",
    );
  }));
}
