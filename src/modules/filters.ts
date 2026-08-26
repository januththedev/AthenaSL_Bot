import { adminOnly } from "../middleware/auth.js";
import {
  deleteFilter,
  listFilters,
  setFilter,
  type FilterEntry,
} from "../store.js";
import type { AthenaBot } from "../bot-types.js";

// ---------------------------------------------------------------------------
// Per-chat filter cache: avoids a database query on every single group message.
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000;
interface CacheSlot {
  at: number;
  entries: FilterEntry[];
}
const cache = new Map<number, CacheSlot>();

/** Cached filter list for a chat; falls back to an empty list on errors. */
export function filterCache(chatId: number): FilterEntry[] {
  const slot = cache.get(chatId);
  if (slot && Date.now() - slot.at < CACHE_TTL_MS) return slot.entries;
  void refreshCache(chatId);
  return slot?.entries ?? [];
}

async function refreshCache(chatId: number): Promise<void> {
  try {
    const entries = await listFilters(chatId);
    cache.set(chatId, { at: Date.now(), entries });
  } catch (err) {
    console.error("filter cache refresh failed", err);
  }
}

function invalidate(chatId: number): void {
  cache.delete(chatId);
  // Fire an immediate refresh so the next message sees fresh data.
  void refreshCache(chatId);
}

/** Pure: first matching auto-reply for the given message text (case-insensitive substring). */
export function findFilterReply(entries: FilterEntry[], text: string): string | null {
  const lower = text.toLowerCase();
  for (const e of entries) {
    if (lower.includes(e.keyword.toLowerCase())) return e.reply;
  }
  return null;
}

export function registerFilterCommands(bot: AthenaBot): void {
  bot.command("filter", adminOnly(async (ctx) => {
    if (!ctx.chat || !ctx.msg) return;
    const keyword = (ctx.match ?? "").trim().split(/\s+/)[0] ?? "";
    if (keyword.length === 0) {
      await ctx.reply("Usage: reply to a message with /filter <keyword> — that message becomes the auto-reply.");
      return;
    }
    const r = ctx.msg.reply_to_message;
    const replyText = r ? (r.text ?? r.caption ?? "") : "";
    if (replyText.length === 0) {
      await ctx.reply(
        `Reply this command to the message that should be sent whenever "${keyword}" appears.`,
      );
      return;
    }
    await setFilter(ctx.chat.id, keyword, replyText);
    invalidate(ctx.chat.id);
    await ctx.reply(`✅ Filter set: messages containing “${keyword}” now get an automatic reply.`);
  }));

  bot.command(["stop", "unfilter", "stopfilter"], adminOnly(async (ctx) => {
    if (!ctx.chat) return;
    const keyword = (ctx.match ?? "").trim();
    if (keyword.length === 0) {
      await ctx.reply("Usage: /stop <keyword>");
      return;
    }
    const deleted = await deleteFilter(ctx.chat.id, keyword);
    invalidate(ctx.chat.id);
    await ctx.reply(deleted > 0 ? `Filter “${keyword}” removed.` : `No filter named “${keyword}”.`);
  }));

  bot.command("filters", adminOnly(async (ctx) => {
    if (!ctx.chat) return;
    const entries = await listFilters(ctx.chat.id);
    await ctx.reply(
      entries.length > 0
        ? `🔍 Active filters:\n${entries.map((e) => `• ${e.keyword}`).join("\n")}`
        : "No filters yet. Create one by replying to a message with /filter <keyword>.",
    );
  }));
}
