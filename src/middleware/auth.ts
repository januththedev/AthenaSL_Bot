import type { AthenaContext } from "../context.js";
import type { CommandContext, NextFunction } from "grammy";

const CACHE_TTL_MS = 5 * 60 * 1000;
interface CacheEntry {
  until: number;
  ids: Set<number>;
}
const adminCache = new Map<number, CacheEntry>();

export async function getAdminIds(ctx: AthenaContext, chatId: number): Promise<Set<number>> {
  const cached = adminCache.get(chatId);
  if (cached && cached.until > Date.now()) return cached.ids;
  try {
    const members = await ctx.api.getChatAdministrators(chatId);
    const ids = new Set(members.map((m) => m.user.id));
    adminCache.set(chatId, { until: Date.now() + CACHE_TTL_MS, ids });
    return ids;
  } catch (err) {
    console.error("getChatAdministrators failed", err);
    return cached?.ids ?? new Set();
  }
}

export function invalidateAdminCache(chatId: number): void {
  adminCache.delete(chatId);
}

export async function isAdmin(ctx: AthenaContext, userId?: number): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const uid = userId ?? ctx.from.id;
  // The anonymous-admin pseudo-user counts as an admin.
  const admins = await getAdminIds(ctx, ctx.chat.id);
  return admins.has(uid) || uid === 1087968824;
}

/** True when the acting user may restrict (mute/ban) members in this chat. */
export async function canRestrict(ctx: AthenaContext, userId?: number): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const uid = userId ?? ctx.from.id;
  try {
    const m = await ctx.api.getChatMember(ctx.chat.id, uid);
    if (m.status === "creator") return true;
    if (m.status === "administrator") return m.can_restrict_members;
    return false;
  } catch {
    return false;
  }
}

/** True when the acting user may delete messages in this chat. */
export async function canDelete(ctx: AthenaContext, userId?: number): Promise<boolean> {
  if (!ctx.chat || !ctx.from) return false;
  const uid = userId ?? ctx.from.id;
  try {
    const m = await ctx.api.getChatMember(ctx.chat.id, uid);
    if (m.status === "creator") return true;
    if (m.status === "administrator") return m.can_delete_messages;
    return false;
  } catch {
    return false;
  }
}

/**
 * Wrap a group command handler so it only runs for admins.
 * Keeps CommandContext typing intact so ctx.match stays a string.
 * Non-admins get a short notice instead of silence.
 */
export function adminOnly(
  handler: (ctx: CommandContext<AthenaContext>) => unknown,
): (ctx: CommandContext<AthenaContext>, next: NextFunction) => Promise<void> {
  return async (ctx) => {
    if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) return;
    if (!(await isAdmin(ctx))) {
      await ctx.reply("🔒 That command is for group admins.");
      return;
    }
    await handler(ctx);
  };
}
