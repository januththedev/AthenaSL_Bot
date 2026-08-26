import type { AthenaContext } from "./context.js";
import type { User } from "grammy/types";

// ---------------------------------------------------------------------------
// AI text helpers (shared by every provider)
// ---------------------------------------------------------------------------

/** Remove <think>…</think> reasoning blocks some free models emit before answering. Pure. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think\s*>/gi, "");
  // Unterminated <think> block (generation cut off): drop everything from the tag onward.
  const open = t.toLowerCase().indexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  return t.trim();
}

/** Detect unusable model output: empty, safety fragments, or leaked reasoning. Pure. */
export function isDegenerate(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  return /^(user safety\s*:|safety\s*:|we need to\b|okay,\s|let me\b|let's\b|first,)/i.test(t);
}

/** Split long text into Telegram-safe chunks, preferring paragraph/line breaks. Pure. */
export function chunkText(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    let cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

// ---------------------------------------------------------------------------
// HTML escaping + templates
// ---------------------------------------------------------------------------

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export interface TemplateVars {
  user?: Pick<User, "id" | "first_name" | "last_name" | "username"> | undefined;
  chatName: string;
  memberCount: number;
}

/** Rose-style fillings: {first} {last} {fullname} {username} {id} {chatname} {count}. Pure. */
export function renderTemplate(template: string, vars: TemplateVars): string {
  const u = vars.user;
  const first = u?.first_name ?? "";
  const last = u?.last_name ?? "";
  const fullname = `${first}${last ? " " + last : ""}`.trim();
  const replacements: Record<string, string> = {
    "{first}": first || "friend",
    "{last}": last || "",
    "{fullname}": fullname || "friend",
    "{username}": u?.username ? `@${u.username}` : "(no username)",
    "{id}": u ? String(u.id) : "?",
    "{chatname}": vars.chatName,
    "{count}": String(vars.memberCount),
  };
  let out = template;
  for (const [token, value] of Object.entries(replacements)) {
    out = out.replaceAll(token, value);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

export interface GroupCtx {
  ctx: AthenaContext;
  chatId: number;
  settings: NonNullable<AthenaContext["settings"]>;
}

/** Narrow to a group context that has settings loaded; replies with an error when not. */
export async function groupContext(ctx: AthenaContext): Promise<GroupCtx | null> {
  if (!ctx.chat || (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup")) {
    await ctx.reply("This command only works in groups.");
    return null;
  }
  if (!ctx.settings) {
    await ctx.reply("Settings are still loading — try again in a second.");
    return null;
  }
  return { ctx, chatId: ctx.chat.id, settings: ctx.settings };
}

export function targetUser(ctx: AthenaContext):
  | { user: User; source: "reply" }
  | { user: User; source: "self" }
  | null {
  const reply = ctx.msg?.reply_to_message;
  if (reply?.from && reply.from.id !== ctx.me.id) {
    return { user: reply.from, source: "reply" };
  }
  if (ctx.from) return { user: ctx.from, source: "self" };
  return null;
}
