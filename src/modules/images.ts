import { InputFile } from "grammy";
import { config } from "../config.js";
import type { AthenaBot } from "../bot-types.js";

const ENDPOINT = "https://image.pollinations.ai";

/** Build the Pollinations image URL for a prompt. Pure. */
export function drawImageUrl(prompt: string, seed: number, model = config.pollinationsModel): string {
  return `${ENDPOINT}/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=${encodeURIComponent(model)}&nologo=true&seed=${seed}`;
}

export function registerDraw(bot: AthenaBot): void {
  bot.command("draw", async (ctx) => {
    const prompt = (ctx.match ?? "").trim();
    if (prompt.length < 3 || prompt.length > 500) {
      await ctx.reply("Usage: /draw <image description> — e.g. /draw water cycle diagram, flat colors");
      return;
    }
    const thinking = await ctx.reply("🎨 Generating image… (10–30s)");
    const url = drawImageUrl(prompt, Math.floor(Math.random() * 1_000_000));
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(55_000) });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) {
        throw new Error(`status ${res.status}, ${type}`);
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
      await ctx.replyWithPhoto(
        new InputFile(buffer, "draw.png"),
        { caption: `🎨 ${prompt.slice(0, 180)}\nvia pollinations.ai` },
      );
    } catch (err) {
      console.error("draw failed", err);
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          thinking.message_id,
          "⚠️ The image service didn't respond in time. Try again in a moment.",
        );
      } catch {
        await ctx.reply("⚠️ The image service didn't respond in time. Try again in a moment.");
      }
    }
  });
}
