import sharp from "sharp";
import { InputFile } from "grammy";
import { askOpenRouter } from "../openrouter.js";
import { incrAskUsage } from "../store.js";
import { isAdmin } from "../middleware/auth.js";
import { config } from "../config.js";
import type { AthenaContext } from "../context.js";
import type { AthenaBot } from "../bot-types.js";

export type ArtifactType = "svg" | "code" | "doc";

export interface Artifact {
  type: ArtifactType;
  filename: string;
  content: string;
}

const EXTENSIONS: Record<ArtifactType, string[]> = {
  svg: [".svg"],
  code: [".py", ".js", ".ts", ".html", ".css", ".java", ".c", ".cpp", ".cs", ".go", ".rs", ".sh", ".sql", ".json", ".kt", ".php", ".rb"],
  doc: [".md", ".txt"],
};

const DEFAULT_FILENAME: Record<ArtifactType, string> = {
  svg: "artifact.svg",
  code: "artifact.py",
  doc: "notes.md",
};

const ARTIFACT_PROMPT = `You are Athena's artifact engine. The user describes an artifact; create it.
Return ONLY a JSON object — no markdown fences, no commentary:
{"type":"svg"|"code"|"doc","filename":"<name>.<ext>","content":"<full content>"}

Rules:
- "svg": one complete standalone <svg> element, viewBox 800x500 or 512x512, built from vector shapes with solid fills and gradients (diagrams, logos, charts, scenes). Use <text> sparingly — the rendering environment may lack fonts.
- "code": one complete, runnable file in the most suitable language, with a brief header comment.
- "doc": a well-structured Markdown document.
- filename: lowercase, letters/digits/dash/dot only, correct extension for the type.
- The content must be complete and self-contained. Never use placeholders like "...rest of code".`;

/** Sanitize an AI-supplied filename; falls back to a type default. Pure. */
export function safeFilename(raw: string, type: ArtifactType): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^[._-]+/, "")
    .slice(0, 40);
  const allowed = EXTENSIONS[type];
  const hit = allowed.find((ext) => cleaned.endsWith(ext));
  if (cleaned.length > 1 && cleaned.includes(".") && hit) return cleaned;
  if (cleaned.length > 1) {
    const base = cleaned.replace(/\.[a-z0-9]+$/, "");
    if (base.length > 0) return `${base}${DEFAULT_FILENAME[type].slice(DEFAULT_FILENAME[type].lastIndexOf("."))}`;
  }
  return DEFAULT_FILENAME[type];
}

/** Extract and validate an artifact from raw model output. Pure. */
export function parseArtifact(raw: string): Artifact | null {
  let t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const type = o["type"];
  if (type !== "svg" && type !== "code" && type !== "doc") return null;
  const content = typeof o["content"] === "string" ? o["content"].trim() : "";
  if (content.length < 20 || content.length > 60_000) return null;
  const filename = safeFilename(typeof o["filename"] === "string" ? o["filename"] : "", type);
  return { type, filename, content };
}

async function deliver(ctx: AthenaContext, artifact: Artifact): Promise<void> {
  if (artifact.type === "svg") {
    try {
      const png = await sharp(Buffer.from(artifact.content, "utf8"), { density: 144 })
        .resize({ width: 1024, height: 1024, fit: "inside", background: "#ffffff" })
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer();
      await ctx.replyWithPhoto(new InputFile(png, `${artifact.filename.replace(/\.svg$/, ".png")}`), {
        caption: `🖼️ ${artifact.filename} (rendered)`,
      });
      // Also provide the editable source.
      await ctx.replyWithDocument(new InputFile(Buffer.from(artifact.content, "utf8"), artifact.filename), {
        caption: "SVG source — edit and re-render anytime.",
      });
      return;
    } catch (err) {
      console.error("svg rasterize failed, sending raw", err);
      await ctx.replyWithDocument(new InputFile(Buffer.from(artifact.content, "utf8"), artifact.filename), {
        caption: "🖼️ SVG artifact (rendering unavailable — open in any browser).",
      });
      return;
    }
  }
  await ctx.replyWithDocument(new InputFile(Buffer.from(artifact.content, "utf8"), artifact.filename), {
    caption: artifact.type === "code" ? "🧩 Code artifact — download and run." : "📄 Document artifact.",
  });
}

export function registerArtifacts(bot: AthenaBot): void {
  bot.command("artifact", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const args = (ctx.match ?? "").trim();
    const replied = ctx.msg?.reply_to_message;
    let description = args;
    if (!description && replied) {
      const target = replied.text ?? replied.caption ?? "";
      if (target.length > 0) description = `Create an artifact based on this:\n${target}`;
    }
    if (description.length < 5) {
      await ctx.reply(
        "Usage: /artifact <description> — the AI builds an SVG image, a code file, or a Markdown doc and sends it here.\nExamples: /artifact pie chart of 25/75 study split • /artifact python prime checker",
      );
      return;
    }
    if (description.length > 3000) description = description.slice(0, 3000);

    // Shares the /ask daily quota to protect the OpenRouter key (admins exempt).
    if (ctx.chat.type !== "private" && !(await isAdmin(ctx))) {
      try {
        const used = await incrAskUsage(ctx.chat.id, ctx.from.id);
        if (used > config.askDailyLimit) {
          await ctx.reply(`You've reached today's AI limit (${config.askDailyLimit}). Try again tomorrow!`);
          return;
        }
      } catch (err) {
        console.error("artifact quota check failed", err);
      }
    }

    const thinking = await ctx.reply("🛠️ Building artifact… (10–30s)");
    const res = await askOpenRouter(description, ARTIFACT_PROMPT);
    if (!res.ok) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ ${res.reason}`);
      } catch {
        await ctx.reply(`⚠️ ${res.reason}`);
      }
      return;
    }
    const artifact = parseArtifact(res.text);
    if (!artifact) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          thinking.message_id,
          "⚠️ The model returned a malformed artifact. Try rephrasing, e.g. start with 'svg:' or 'python code that…'.",
        );
      } catch {
        await ctx.reply("⚠️ The model returned a malformed artifact. Try rephrasing.");
      }
      return;
    }
    try {
      await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    } catch {
      // ignore
    }
    await deliver(ctx, artifact);
  });
}
