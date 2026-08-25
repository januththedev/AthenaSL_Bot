import { adminOnly } from "../middleware/auth.js";
import { deleteNote, getNote, listNotes, setNote } from "../store.js";
import type { AthenaContext } from "../context.js";
import type { AthenaBot } from "../bot-types.js";

/** Extract unique lowercase #tag names from message text. Pure. */
export function extractNoteTags(text: string): string[] {
  const matches = text.matchAll(/#([\p{L}\p{N}_]{2,32})/gu);
  const seen = new Set<string>();
  for (const m of matches) {
    const tag = m[1]?.toLowerCase();
    if (tag) seen.add(tag);
    if (seen.size >= 5) break;
  }
  return [...seen];
}

/** Pipeline step: if the message contains a hashtag that names a note, post it. */
export async function replyFirstNoteTag(ctx: AthenaContext, text: string): Promise<void> {
  if (!ctx.chat) return;
  const tags = extractNoteTags(text);
  // Cap Redis lookups per message to keep REST calls cheap.
  for (const tag of tags.slice(0, 3)) {
    const content = await getNote(ctx.chat.id, tag);
    if (content !== null && content !== undefined && String(content).length > 0) {
      await ctx.reply(String(content));
      return;
    }
  }
}

function repliedContent(ctx: AthenaContext): string {
  const r = ctx.msg?.reply_to_message;
  return r ? (r.text ?? r.caption ?? "") : "";
}

export function registerNoteCommands(bot: AthenaBot): void {
  bot.command("save", adminOnly(async (ctx) => {
    if (!ctx.chat || !ctx.msg) return;
    const args = (ctx.match ?? "").trim();
    const spaceIdx = args.search(/\s/);
    const name = (spaceIdx === -1 ? args : args.slice(0, spaceIdx)).replace(/^#/, "");
    const inlineBody = spaceIdx === -1 ? "" : args.slice(spaceIdx + 1).trim();
    if (name.length === 0) {
      await ctx.reply("Usage: /save <name> [text] — or reply to a message with /save <name>.");
      return;
    }
    const content = repliedContent(ctx) || inlineBody;
    if (content.length === 0) {
      await ctx.reply("Nothing to save — include text after the name, or reply to a message.");
      return;
    }
    await setNote(ctx.chat.id, name, content);
    await ctx.reply(`💾 Note saved as #${name}. Use #${name} or /get ${name} to view it.`);
  }));

  bot.command("get", async (ctx) => {
    if (!ctx.chat) return;
    const name = (ctx.match ?? "").trim().replace(/^#/, "");
    if (name.length === 0) {
      await ctx.reply("Usage: /get <name>");
      return;
    }
    const content = await getNote(ctx.chat.id, name);
    await ctx.reply(content ?? `No note named #${name}.`);
  });

  bot.command("clear", adminOnly(async (ctx) => {
    if (!ctx.chat) return;
    const name = (ctx.match ?? "").trim().replace(/^#/, "");
    if (name.length === 0) {
      await ctx.reply("Usage: /clear <name>");
      return;
    }
    const deleted = await deleteNote(ctx.chat.id, name);
    await ctx.reply(deleted > 0 ? `🗑 Note #${name} deleted.` : `No note named #${name}.`);
  }));

  bot.command("notes", async (ctx) => {
    if (!ctx.chat) return;
    const names = await listNotes(ctx.chat.id);
    await ctx.reply(
      names.length > 0
        ? `📚 Notes in this chat:\n${names.map((n) => `#${n}`).join(", ")}`
        : "No notes saved yet. Save one with /save <name>.",
    );
  });
}
