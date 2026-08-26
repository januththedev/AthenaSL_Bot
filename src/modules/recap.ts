import { askOpenRouter } from "../openrouter.js";
import { kvGet, kvSet, quotaDay } from "../store.js";
import { escapeHtml } from "../utils.js";
import type { Message, User } from "grammy/types";
import type { AthenaBot } from "../bot-types.js";

export interface RecapEntry {
  u: string;
  t: string;
}

export interface ResourceLink {
  url: string;
  by: string;
  at: number;
}

const logKey = (chatId: number, day: string) => `log:${chatId}:${day}`;
const resKey = (chatId: number) => `res:${chatId}`;
const RECAP_PROMPT =
  "You are Athena, a study-group assistant. Below is today's chat log from a student group " +
  "(Name: message). Produce a recap for members who were away: " +
  "1-2 line overview, then dashes for main topics, questions asked (with the answer if visible), " +
  "and any deadlines/announcements. Max 140 words, plain text, no preamble.";

/** Collect URLs from message entities (pure). */
export function extractUrls(text: string, entities: { type: string; url?: string; offset?: number; length?: number }[] | undefined): string[] {
  const out: string[] = [];
  for (const e of entities ?? []) {
    if (e.type === "text_link" && e.url) out.push(e.url);
    if (e.type === "url" && typeof e.offset === "number" && typeof e.length === "number") {
      const u = text.slice(e.offset, e.offset + e.length);
      if (u) out.push(u);
    }
  }
  return [...new Set(out)];
}

/**
 * Pipeline hook: appends plain messages to today's recap log and collects
 * shared links. Requires Telegram Group Privacy to be OFF for the bot to
 * even receive member messages.
 */
export async function logForRecap(chatId: number, from: User, msg: Message): Promise<void> {
  const text = msg.text ?? "";
  if (text.length >= 2 && !text.startsWith("/")) {
    const key = logKey(chatId, quotaDay());
    const log = (await kvGet<RecapEntry[]>(key)) ?? [];
    log.push({ u: from.first_name ?? "?", t: text.slice(0, 200) });
    await kvSet(key, log.slice(-300), 3 * 86_400);
  }

  const urls = extractUrls(msg.text ?? msg.caption ?? "", (msg.entities ?? msg.caption_entities) as never);
  if (urls.length === 0) return;
  const res = (await kvGet<ResourceLink[]>(resKey(chatId))) ?? [];
  let changed = false;
  for (const url of urls) {
    if (!res.some((r) => r.url === url)) {
      res.push({ url, by: from.first_name ?? "?", at: Date.now() });
      changed = true;
    }
  }
  if (changed) await kvSet(resKey(chatId), res.slice(-50));
}

export function registerRecap(bot: AthenaBot): void {
  bot.command("recap", async (ctx) => {
    if (!ctx.chat) return;
    const log = (await kvGet<RecapEntry[]>(logKey(ctx.chat.id, quotaDay()))) ?? [];
    if (log.length < 5) {
      await ctx.reply(
        "Not enough chat captured today for a recap (I need ~5+ messages).\n" +
          "Note: I can only see normal messages if Group Privacy is OFF (BotFather → Bot Settings → Group Privacy).",
      );
      return;
    }
    const transcript = log.map((e) => `${e.u}: ${e.t}`).join("\n").slice(0, 12_000);
    const thinking = await ctx.reply("📖 Catching up on today…");
    const res = await askOpenRouter(transcript, RECAP_PROMPT);
    const body = res.ok ? res.text : `⚠️ ${res.reason}`;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, body.slice(0, 4000));
    } catch {
      await ctx.reply(body.slice(0, 4000));
    }
  });

  bot.command("resources", async (ctx) => {
    if (!ctx.chat) return;
    const links = (await kvGet<ResourceLink[]>(resKey(ctx.chat.id))) ?? [];
    if (links.length === 0) {
      await ctx.reply("No links collected yet — post some and I'll index them here automatically.");
      return;
    }
    const lines = links
      .slice(-20)
      .reverse()
      .map((r) => `• ${escapeHtml(shorten(r.url))} — ${escapeHtml(r.by)}`);
    await ctx.reply(`🔗 Shared links (${links.length} total, newest first):\n${lines.join("\n")}`, {
      parse_mode: "HTML",
    });
  });
}

function shorten(url: string, max = 70): string {
  return url.length > max ? `${url.slice(0, max - 3)}…` : url;
}
