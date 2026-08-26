import { InputFile } from "grammy";
import { askOpenRouter } from "../openrouter.js";
import { incrAskUsage } from "../store.js";
import { isAdmin } from "../middleware/auth.js";
import { config } from "../config.js";
import type { AthenaContext } from "../context.js";
import type { AthenaBot } from "../bot-types.js";

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export interface ChartItem {
  label: string;
  value: number;
}

export interface ChartSpec {
  type: "bar" | "line" | "pie";
  title: string;
  subtitle?: string;
  unit?: string;
  notes?: string;
  items: ChartItem[];
}

const CHART_PROMPT = `You convert a request into a precise chart specification.
Return ONLY JSON — no markdown fences, no commentary:
{"type":"bar"|"line"|"pie","title":"...","subtitle":"...","unit":"...","notes":"...","items":[{"label":"...","value":123}]}

Rules:
- Use CORRECT real-world values, from the request or your knowledge. Never invent plausible-looking numbers silently — if a value is uncertain, say so in "notes".
- 2 to 8 items; values are finite magnitudes >= 0.
- "bar" for comparing categories, "line" for trends over time, "pie" for parts of a whole.
- "title" is short; "subtitle" may add context (e.g. "as of 2025"); "unit" like "km", "%", "million people".
- Keep labels under 20 characters.`;

/** Extract and validate a chart spec from raw model output. Pure. */
export function parseChartSpec(raw: string): ChartSpec | null {
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
  if (o["type"] !== "bar" && o["type"] !== "line" && o["type"] !== "pie") return null;
  const title = typeof o["title"] === "string" ? o["title"].trim().slice(0, 120) : "";
  if (title.length === 0) return null;
  if (!Array.isArray(o["items"]) || o["items"].length < 2 || o["items"].length > 10) return null;
  const items: ChartItem[] = [];
  for (const item of o["items"]) {
    if (item === null || typeof item !== "object") return null;
    const it = item as Record<string, unknown>;
    const label = typeof it["label"] === "string" ? it["label"].trim().slice(0, 40) : "";
    const value = typeof it["value"] === "number" ? it["value"] : Number.NaN;
    if (label.length === 0 || !Number.isFinite(value) || value < 0) return null;
    items.push({ label, value });
  }
  const opt = (k: string, max: number): string | undefined => {
    const v = o[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : undefined;
  };
  return {
    type: o["type"],
    title,
    subtitle: opt("subtitle", 140),
    unit: opt("unit", 16),
    notes: opt("notes", 160),
    items,
  };
}

/**
 * Pull an optional trailing `CHART:{...}` marker out of an /ask answer.
 * Pure; missing/invalid markers simply yield no chart.
 */
export function extractChartMarker(text: string): { answer: string; spec: ChartSpec | null } {
  const idx = text.toUpperCase().lastIndexOf("CHART:");
  if (idx === -1) return { answer: text.trim(), spec: null };
  const spec = parseChartSpec(text.slice(idx + 6));
  return { answer: text.slice(0, idx).trim(), spec };
}

// ---------------------------------------------------------------------------
// Rendering (pure SVG)
// ---------------------------------------------------------------------------

const PALETTE = ["#6d28d9", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#8b5cf6", "#0ea5e9", "#84cc16"];

export function formatNumber(v: number): string {
  const abs = Math.abs(v);
  const trim = (s: string) => s.replace(/\.0+([A-Z])?$/, "$1").replace(/(\.\d)0([A-Z])?$/, "$1$2");
  if (abs >= 1e9) return trim((v / 1e9).toFixed(1)) + "B";
  if (abs >= 1e6) return trim((v / 1e6).toFixed(1)) + "M";
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const W = 1000;

/** Deterministic SVG chart — labels and values come from the spec, never drawn by AI. Pure. */
export function renderChartSvg(spec: ChartSpec): string {
  const H = 620;
  const font = (size: number, weight = "normal", fill = "#111827") =>
    `font-family="DejaVu Sans, sans-serif" font-size="${size}" font-weight="${weight}" fill="${fill}"`;
  const parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="50" y="54" ${font(30, "bold")}>${escapeXml(spec.title)}</text>`);
  const subtitle = spec.subtitle ?? (spec.unit ? `Values in ${spec.unit}` : "");
  if (subtitle) parts.push(`<text x="50" y="86" ${font(18, "normal", "#6b7280")}>${escapeXml(subtitle)}</text>`);

  const values = spec.items.map((i) => i.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values);
  const sqrtScale = min > 0 && max / min >= 100;
  const scale = (v: number): number => (sqrtScale ? Math.sqrt(v / max) : v / max);
  const unitSuffix = spec.unit ? ` ${spec.unit}` : "";

  if (spec.type === "pie") {
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = 330;
    const cy = 350;
    const r = 200;
    let angle = -Math.PI / 2;
    spec.items.forEach((item, i) => {
      const frac = item.value / total;
      const a2 = angle + frac * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      const x2 = cx + r * Math.cos(a2);
      const y2 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      parts.push(
        `<path d="M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#ffffff" stroke-width="2"/>`,
      );
      const lx = 620;
      const ly = 200 + i * 38;
      parts.push(`<rect x="${lx}" y="${ly - 14}" width="18" height="18" rx="4" fill="${PALETTE[i % PALETTE.length]}"/>`);
      parts.push(
        `<text x="${lx + 28}" y="${ly}" ${font(17)}>${escapeXml(item.label)} — ${formatNumber(item.value)}${unitSuffix} (${Math.round(frac * 100)}%)</text>`,
      );
      angle = a2;
    });
  } else {
    const padL = 90;
    const padR = 50;
    const padT = 120;
    const padB = 100;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const baseline = padT + plotH;

    for (let i = 0; i <= 4; i++) {
      const y = padT + plotH * (1 - i / 4);
      parts.push(`<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`);
      const tick = (max * i) / 4;
      parts.push(
        `<text x="${padL - 12}" y="${y + 5}" ${font(14, "normal", "#6b7280")} text-anchor="end">${escapeXml(formatNumber(tick))}</text>`,
      );
    }
    parts.push(`<line x1="${padL}" y1="${baseline}" x2="${W - padR}" y2="${baseline}" stroke="#9ca3af" stroke-width="1.5"/>`);

    const label = (v: number) => escapeXml(`${formatNumber(v)}${unitSuffix}`);

    if (spec.type === "bar") {
      const slot = plotW / spec.items.length;
      const barW = Math.min(slot * 0.6, 130);
      spec.items.forEach((item, i) => {
        const h = plotH * scale(item.value);
        const x = padL + slot * i + (slot - barW) / 2;
        const y = baseline - h;
        parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(h, 2).toFixed(1)}" rx="6" fill="${PALETTE[i % PALETTE.length]}"/>`);
        parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 10).toFixed(1)}" ${font(16)} text-anchor="middle">${label(item.value)}</text>`);
        parts.push(`<text x="${(x + barW / 2).toFixed(1)}" y="${baseline + 26}" ${font(15, "normal", "#374151")} text-anchor="middle">${escapeXml(item.label.slice(0, 26))}</text>`);
      });
    } else {
      // line
      const n = spec.items.length;
      const px = (i: number) => padL + (n === 1 ? plotW / 2 : (plotW * i) / (n - 1));
      const py = (v: number) => baseline - plotH * scale(v);
      const points = spec.items.map((it, i) => `${px(i).toFixed(1)},${py(it.value).toFixed(1)}`).join(" ");
      parts.push(`<polyline points="${points}" fill="none" stroke="#6d28d9" stroke-width="3.5" stroke-linejoin="round"/>`);
      spec.items.forEach((item, i) => {
        parts.push(`<circle cx="${px(i).toFixed(1)}" cy="${py(item.value).toFixed(1)}" r="6" fill="#6d28d9"/>`);
        parts.push(`<text x="${px(i).toFixed(1)}" y="${(py(item.value) - 14).toFixed(1)}" ${font(15)} text-anchor="middle">${label(item.value)}</text>`);
        parts.push(`<text x="${px(i).toFixed(1)}" y="${baseline + 26}" ${font(15, "normal", "#374151")} text-anchor="middle">${escapeXml(item.label.slice(0, 24))}</text>`);
      });
    }
  }

  const footnote =
    (spec.notes ?? "Data: AI knowledge — double-check critical values.") +
    (sqrtScale && spec.type !== "pie" ? " • lengths use √ scale; labels show true values" : "");
  parts.push(`<text x="50" y="${H - 22}" ${font(13, "normal", "#9ca3af")}>${escapeXml(footnote)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join("")}</svg>`;
}

/** Rasterize with the bundled DejaVu font so text renders identically on any host. */
export async function renderChartPng(spec: ChartSpec): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const { DEJAVU_SANS_B64 } = await import("../font-dejavu.js");
  // resvg's typed options accept font files by path — materialize the bundled
  // font into the (writable) temp dir once per instance.
  const { writeFile, access } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const os = await import("node:os");
  const { constants } = await import("node:fs");
  const fontPath = join(os.tmpdir(), "athena-dejavu.ttf");
  try {
    await access(fontPath, constants.F_OK);
  } catch {
    await writeFile(fontPath, Buffer.from(DEJAVU_SANS_B64, "base64"));
  }
  const resvg = new Resvg(renderChartSvg(spec), {
    fitTo: { mode: "width", value: W },
    font: {
      fontFiles: [fontPath],
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Sans",
    },
    background: "#ffffff",
  });
  return Buffer.from(resvg.render().asPng());
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function deliverChart(ctx: AthenaContext, spec: ChartSpec, caption?: string): Promise<void> {
  const png = await renderChartPng(spec);
  await ctx.replyWithPhoto(new InputFile(png, "chart.png"), {
    caption: caption ?? `📊 ${spec.title}${spec.unit ? ` (in ${spec.unit})` : ""}`,
  });
}

export function registerChart(bot: AthenaBot): void {
  bot.command("chart", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const args = (ctx.match ?? "").trim();
    const replied = ctx.msg?.reply_to_message;
    let request = args;
    if (!request && replied) {
      const target = replied.text ?? replied.caption ?? "";
      if (target.length > 0) request = `Chart this: ${target}`;
    }
    if (request.length < 5) {
      await ctx.reply(
        "Usage: /chart <question or data> — builds a precise, data-accurate chart.\nExamples: /chart compare distance to the moon and voyager 1 • /chart world population by continent",
      );
      return;
    }
    if (request.length > 2000) request = request.slice(0, 2000);

    if (ctx.chat.type !== "private" && !(await isAdmin(ctx))) {
      try {
        const used = await incrAskUsage(ctx.chat.id, ctx.from.id);
        if (used > config.askDailyLimit) {
          await ctx.reply(`You've reached today's AI limit (${config.askDailyLimit}). Try again tomorrow!`);
          return;
        }
      } catch (err) {
        console.error("chart quota check failed", err);
      }
    }

    const thinking = await ctx.reply("📊 Building precise chart…");
    const res = await askOpenRouter(request, CHART_PROMPT);
    if (!res.ok) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, thinking.message_id, `⚠️ ${res.reason}`);
      } catch {
        await ctx.reply(`⚠️ ${res.reason}`);
      }
      return;
    }
    const spec = parseChartSpec(res.text);
    if (!spec) {
      try {
        await ctx.api.editMessageText(
          ctx.chat.id,
          thinking.message_id,
          "⚠️ Couldn't turn that into a chart. Include the comparison or data, e.g. /chart population of Japan vs Germany 2025",
        );
      } catch {
        await ctx.reply("⚠️ Couldn't turn that into a chart. Include the comparison or data.");
      }
      return;
    }
    try {
      await ctx.api.deleteMessage(ctx.chat.id, thinking.message_id).catch(() => {});
    } catch {
      // ignore
    }
    await deliverChart(ctx, spec);
  });
}
