import {
  type ChatSettings,
} from "../store.js";
import { escapeHtml, groupContext, renderTemplate } from "../utils.js";
import type { User } from "grammy/types";
import { adminOnly } from "../middleware/auth.js";
import type { AthenaBot } from "../bot-types.js";

const DEFAULT_WELCOME = "Hey {first}, welcome to {chatname}!";
const DEFAULT_GOODBYE = "{first} has left {chatname}. 👋";

function safeUser(u?: User): User | undefined {
  if (!u) return undefined;
  return {
    ...u,
    first_name: escapeHtml(u.first_name ?? ""),
    last_name: escapeHtml(u.last_name ?? ""),
  };
}

/** Render a welcome/goodbye template for a specific user event. */
export async function renderGreeting(
  bot: AthenaBot,
  settings: ChatSettings,
  chatId: number,
  chatName: string,
  template: string,
  user: User | undefined,
): Promise<string> {
  let count = 0;
  try {
    count = await bot.api.getChatMemberCount(chatId);
  } catch {
    // count stays 0 → rendered as "?"
  }
  return renderTemplate(template, {
    user: safeUser(user),
    chatName: escapeHtml(chatName),
    memberCount: count,
  });
}

async function sendFormatted(bot: AthenaBot, chatId: number, text: string): Promise<void> {
  try {
    await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
  } catch {
    await bot.api.sendMessage(chatId, text);
  }
}

interface GreetingSide {
  key: "welcome" | "goodbye";
  label: string;
  commandBase: string;
  defaultText: string;
}

const SIDES: GreetingSide[] = [
  { key: "welcome", label: "Welcome", commandBase: "welcome", defaultText: DEFAULT_WELCOME },
  { key: "goodbye", label: "Goodbye", commandBase: "goodbye", defaultText: DEFAULT_GOODBYE },
];

function registerGreetingCommands(bot: AthenaBot, side: GreetingSide): void {
  const get = (s: ChatSettings) => s[side.key];

  bot.command(side.commandBase, async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const cfg = get(g.settings);
    const arg = (ctx.match ?? "").trim().toLowerCase();
    let enabledNote = cfg.enabled ? "enabled" : "disabled";
    if (["off", "no", "disable", "false"].includes(arg)) {
      cfg.enabled = false;
      enabledNote = "disabled";
    } else if (["on", "yes", "enable", "true"].includes(arg)) {
      cfg.enabled = true;
      enabledNote = "enabled";
    }
    const preview = await renderGreeting(
      bot,
      g.settings,
      g.chatId,
      g.ctx.chat?.title ?? "this chat",
      cfg.text ?? side.defaultText,
      ctx.from,
    );
    await ctx.reply(
      `${side.label} messages are <b>${enabledNote}</b>.\nCurrent ${side.label.toLowerCase()} message:\n\n${preview}`,
      { parse_mode: "HTML" },
    );
  });

  bot.command(`set${side.commandBase}`, adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const text = (ctx.match ?? "").trim();
    if (text.length === 0) {
      await ctx.reply(
        `Usage: /set${side.commandBase} <text>\nFillings: {first} {last} {fullname} {username} {id} {chatname} {count}`,
      );
      return;
    }
    if (text.length > 2500) {
      await ctx.reply("Too long — max ~2500 characters.");
      return;
    }
    get(g.settings).text = text;
    get(g.settings).enabled = true;
    const preview = await renderGreeting(bot, g.settings, g.chatId, g.ctx.chat?.title ?? "", text, ctx.from);
    await ctx.reply(`${side.label} message saved (and enabled):\n\n${preview}`, { parse_mode: "HTML" });
  }));

  bot.command(`reset${side.commandBase}`, adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    get(g.settings).text = null;
    await ctx.reply(`${side.label} message reset to the default.`);
  }));
}

/**
 * Member events: welcome humans, say goodbye, and auto-ban bots when
 * the "bots" lock is active.
 */
export function registerMemberEvents(bot: AthenaBot): void {
  // Both handlers call next() so the guards pipeline (cleanservice, etc.)
  // still runs for service messages.
  bot.on("message:new_chat_members", async (ctx, next) => {
    const settings = ctx.settings;
    if (settings && ctx.msg) {
      const entrants = ctx.msg.new_chat_members;

      // "bots" lock: kick newly joined bots immediately.
      if (settings.locks.includes("bots")) {
        for (const m of entrants) {
          if (!m.is_bot) continue;
          try {
            await bot.api.banChatMember(ctx.chat.id, m.id);
          } catch (err) {
            console.error("bot-lock ban failed", err);
          }
        }
      }

      const cfg = settings.welcome;
      const human = entrants.find((m) => !m.is_bot);
      if (cfg.enabled && human) {
        try {
          const text = await renderGreeting(
            bot,
            settings,
            ctx.chat.id,
            ctx.chat.title ?? "",
            cfg.text ?? DEFAULT_WELCOME,
            human,
          );
          await sendFormatted(bot, ctx.chat.id, text);
        } catch (err) {
          console.error("welcome failed", err);
        }
      }
    }
    await next();
  });

  bot.on("message:left_chat_member", async (ctx, next) => {
    const settings = ctx.settings;
    if (settings && ctx.msg) {
      const cfg = settings.goodbye;
      const leaver = ctx.msg.left_chat_member;
      if (cfg.enabled && leaver && !leaver.is_bot && leaver.id !== ctx.me.id) {
        try {
          const text = await renderGreeting(
            bot,
            settings,
            ctx.chat.id,
            ctx.chat.title ?? "",
            cfg.text ?? DEFAULT_GOODBYE,
            leaver,
          );
          await sendFormatted(bot, ctx.chat.id, text);
        } catch (err) {
          console.error("goodbye failed", err);
        }
      }
    }
    await next();
  });
}

export function registerWelcome(bot: AthenaBot): void {
  for (const side of SIDES) registerGreetingCommands(bot, side);
  registerMemberEvents(bot);
}
