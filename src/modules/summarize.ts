import { askOpenRouter } from "../openrouter.js";
import type { AthenaBot } from "../bot-types.js";

const SUMMARIZE_PROMPT =
  "You are Athena, a study-group assistant. Summarize the following content for students. " +
  "Give the key points as short dashes (max 8 bullets), plain text only (Telegram), under 130 words total. " +
  "If it is study material, end with one line: 'Focus on: <the single most exam-relevant idea>.'";

const MAX_SOURCE = 15_000;

/** Fetch a page and extract readable text. Returns null on any failure. */
export async function fetchUrlText(rawUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "AthenaBot/1.0 (link summarizer)" },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) return null;
    const html = (await res.text()).slice(0, 400_000);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 200 ? text.slice(0, MAX_SOURCE) : null;
  } catch (err) {
    console.error("fetchUrlText failed", err);
    return null;
  }
}

function firstUrl(
  ctxText: string,
  entities: { type: string; url?: string; offset?: number; length?: number }[] | undefined,
): string | null {
  for (const e of entities ?? []) {
    if (e.type === "text_link" && e.url) return e.url;
    if (e.type === "url" && typeof e.offset === "number" && typeof e.length === "number") {
      const slice = ctxText.slice(e.offset, e.offset + e.length);
      if (slice) return slice;
    }
  }
  const bare = ctxText.match(/https?:\/\/\S+/);
  return bare ? bare[0] : null;
}

export function registerSummarize(bot: AthenaBot): void {
  bot.command(["summarize", "tldr"], async (ctx) => {
    if (!ctx.chat) return;
    const replied = ctx.msg?.reply_to_message;
    if (!replied) {
      await ctx.reply("Reply to a long message or a link with /summarize.");
      return;
    }
    const text = replied.text ?? replied.caption ?? "";
    const entities = (replied.entities ?? replied.caption_entities) as
      | { type: string; url?: string; offset?: number; length?: number }[]
      | undefined;
    const url = firstUrl(text, entities);

    let source = text;
    let note = "";
    if (url && text.replace(/https?:\/\/\S+/g, "").trim().length < 200) {
      const page = await fetchUrlText(url);
      if (!page) {
        await ctx.reply("⚠️ Couldn't read that link (unsupported page or blocked).");
        return;
      }
      source = page;
      note = `📄 ${url}\n\n`;
    }

    if (source.trim().length < 200) {
      await ctx.reply("That message is too short to be worth summarizing (need ~200+ characters).");
      return;
    }
    if (source.length > MAX_SOURCE) source = source.slice(0, MAX_SOURCE);

    const thinking = await ctx.reply("📝 Reading…");
    const res = await askOpenRouter(`Summarize this:\n\n${source}`, SUMMARIZE_PROMPT);
    const body = res.ok ? res.text : `⚠️ ${res.reason}`;
    try {
      await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `${note}${body}`.slice(0, 4000));
    } catch {
      await ctx.reply(`${note}${body}`.slice(0, 4000));
    }
  });
}
