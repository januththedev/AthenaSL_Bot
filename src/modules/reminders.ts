import { adminOnly } from "../middleware/auth.js";
import { escapeHtml } from "../utils.js";
import { kvDel, kvGet, kvKeys, kvSet, quotaDay } from "../store.js";
import type { AthenaBot } from "../bot-types.js";

export interface Reminder {
  chatId: number;
  at: number;
  text: string;
  by: string;
}

export interface ExamEntry {
  chatId: number;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  announcedOn: string | null;
}

const MAX_REMINDERS_PER_CHAT = 30;

export type ParsedWhen =
  | { ok: true; at: number; label: string }
  | { ok: false; hint: string };

const WHEN_HINT =
  "Time formats: /remind 1h30m <text> • /remind 18:30 <text> • /remind tomorrow <text> • /remind 2026-09-01 <text>";

/**
 * Parse a flexible "when" expression into an epoch-ms timestamp.
 * Clock-based forms (HH:MM, bare dates, "tomorrow") use the server's local
 * timezone — UTC on Vercel, your PC's timezone in local dev. Pure.
 */
export function parseWhen(input: string, now: Date = new Date()): ParsedWhen {
  const s = input.trim().toLowerCase();
  if (s.length === 0 || s.length > 32) return { ok: false, hint: WHEN_HINT };

  // Relative duration: 90s, 45m, 2h, 1d, 1d2h30m …
  const rel = s.match(/^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (rel && (rel[1] || rel[2] || rel[3] || rel[4])) {
    const d = Number(rel[1] ?? 0);
    const h = Number(rel[2] ?? 0);
    const m = Number(rel[3] ?? 0);
    const sec = Number(rel[4] ?? 0);
    const ms = (((d * 24 + h) * 60 + m) * 60 + sec) * 1000;
    if (ms < 15_000) return { ok: false, hint: "Minimum reminder time is 15 seconds." };
    if (ms > 90 * 86_400_000) return { ok: false, hint: "Reminders can be at most 90 days ahead." };
    return { ok: true, at: now.getTime() + ms, label: s };
  }

  // Clock time HH:MM → next occurrence
  const hm = s.match(/^(\d{1,2})[:.](\d{2})$/);
  if (hm) {
    const hh = Number(hm[1]);
    const mm = Number(hm[2]);
    if (hh > 23 || mm > 59) return { ok: false, hint: WHEN_HINT };
    const t = new Date(now);
    t.setHours(hh, mm, 0, 0);
    if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
    return { ok: true, at: t.getTime(), label: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
  }

  // Date, optionally with time: YYYY-MM-DD [HH:MM]
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?$/);
  if (dt) {
    const t = new Date(
      Number(dt[1]),
      Number(dt[2]) - 1,
      Number(dt[3]),
      dt[4] ? Number(dt[4]) : 9,
      dt[5] ? Number(dt[5]) : 0,
      0,
      0,
    );
    if (Number.isNaN(t.getTime())) return { ok: false, hint: WHEN_HINT };
    return { ok: true, at: t.getTime(), label: s };
  }

  if (s === "tomorrow" || s === "tmr") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    t.setHours(9, 0, 0, 0);
    return { ok: true, at: t.getTime(), label: "tomorrow 09:00" };
  }

  return { ok: false, hint: WHEN_HINT };
}

function formatWhen(at: number): string {
  return new Date(at).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

export function registerReminders(bot: AthenaBot): void {
  bot.command("remind", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const args = (ctx.match ?? "").trim();
    const split = args.search(/\s/);
    const whenStr = split === -1 ? args : args.slice(0, split);
    const text = split === -1 ? "" : args.slice(split + 1).trim();
    const parsed = parseWhen(whenStr);
    if (!parsed.ok) {
      await ctx.reply(`⏰ ${parsed.hint}`);
      return;
    }
    if (text.length === 0 || text.length > 500) {
      await ctx.reply("Usage: /remind <time> <what to remind about> (max 500 chars)");
      return;
    }
    const chatId = ctx.chat.id;
    const existing = await kvKeys(`remind:${chatId}:*`);
    if (existing.length >= MAX_REMINDERS_PER_CHAT) {
      await ctx.reply(`This chat already has ${MAX_REMINDERS_PER_CHAT} pending reminders — clear some with /delremind.`);
      return;
    }
    const key = `remind:${chatId}:${now36()}`;
    const entry: Reminder = { chatId, at: parsed.at, text, by: ctx.from.first_name ?? "someone" };
    await kvSet(key, entry, 90 * 86_400);
    await ctx.reply(`⏰ OK — I'll remind this chat on ${formatWhen(parsed.at)}:\n“${escapeHtml(text)}”`, { parse_mode: "HTML" });
  });

  bot.command(["reminders", "remindlist"], async (ctx) => {
    if (!ctx.chat) return;
    const keys = await kvKeys(`remind:${ctx.chat.id}:*`);
    const entries = await Promise.all(keys.map((k) => kvGet<Reminder>(k).then((r) => (r ? { k, r } : null))));
    const live = entries
      .filter((e): e is { k: string; r: Reminder } => e !== null)
      .sort((a, b) => a.r.at - b.r.at);
    if (live.length === 0) {
      await ctx.reply("No pending reminders. Set one with /remind <time> <text>.");
      return;
    }
    const lines = live.map(({ k, r }) => {
      const inMin = Math.max(0, Math.round((r.at - Date.now()) / 60_000));
      const dur = inMin >= 60 ? `${Math.floor(inMin / 60)}h${inMin % 60}m` : `${inMin}m`;
      return `• in ${dur} — ${escapeHtml(r.text)} <code>${k.slice(-6)}</code>`;
    });
    await ctx.reply(`⏰ Pending reminders:\n${lines.join("\n")}\n\nCancel with /delremind <code>`, { parse_mode: "HTML" });
  });

  bot.command("delremind", async (ctx) => {
    if (!ctx.chat) return;
    const id = (ctx.match ?? "").trim();
    if (id.length === 0) {
      await ctx.reply("Usage: /delremind <code> (see /reminders)");
      return;
    }
    const keys = await kvKeys(`remind:${ctx.chat.id}:*`);
    const hit = keys.find((k) => k.endsWith(id));
    if (!hit) {
      await ctx.reply("No reminder with that code.");
      return;
    }
    await kvDel(hit);
    await ctx.reply("🗑 Reminder cancelled.");
  });

  bot.command("exam", adminOnly(async (ctx) => {
    if (!ctx.chat) return;
    const args = (ctx.match ?? "").trim();
    const split = args.search(/\s/);
    const dateStr = split === -1 ? args : args.slice(0, split);
    const name = split === -1 ? "" : args.slice(split + 1).trim();
    const parsed = parseWhen(dateStr);
    if (!parsed.ok || !/^\d{4}-\d{2}-\d{2}/.test(dateStr.trim())) {
      await ctx.reply("Usage: /exam <YYYY-MM-DD> <exam name> — e.g. /exam 2026-09-10 Physics midterm");
      return;
    }
    if (name.length === 0 || name.length > 80) {
      await ctx.reply("Give the exam a name (max 80 chars).");
      return;
    }
    const date = parsed.at > 0 ? new Date(parsed.at).toISOString().slice(0, 10) : quotaDay();
    const key = `exam:${ctx.chat.id}:${name.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`;
    const entry: ExamEntry = { chatId: ctx.chat.id, name, date, announcedOn: null };
    await kvSet(key, entry, 400 * 86_400);
    const days = Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${quotaDay()}T00:00:00Z`)) / 86_400_000);
    await ctx.reply(`📅 Countdown set: ${escapeHtml(name)} on ${date} (${days} day${days === 1 ? "" : "s"} away). I'll post a daily countdown here.`, { parse_mode: "HTML" });
  }));

  bot.command(["exams", "examlist"], async (ctx) => {
    if (!ctx.chat) return;
    const keys = await kvKeys(`exam:${ctx.chat.id}:*`);
    const entries = await Promise.all(keys.map((k) => kvGet<ExamEntry>(k).then((e) => (e ? { k, e } : null))));
    const live = entries.filter((x): x is { k: string; e: ExamEntry } => x !== null).sort((a, b) => a.e.date.localeCompare(b.e.date));
    if (live.length === 0) {
      await ctx.reply("No exam countdowns. Admins can add one with /exam <YYYY-MM-DD> <name>.");
      return;
    }
    const lines = live.map(({ e }) => {
      const days = Math.ceil((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${quotaDay()}T00:00:00Z`)) / 86_400_000);
      return `• ${e.date} — ${escapeHtml(e.name)} (${days <= 0 ? "today/past" : `${days}d`})`;
    });
    await ctx.reply(`📅 Exam countdowns:\n${lines.join("\n")}`, { parse_mode: "HTML" });
  });
}

function now36(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Cron step: post due reminders and daily exam countdowns.
 * Called every minute by scripts/dev-poll.ts (local) or api/cron.ts (Vercel).
 */
export async function processDueReminders(bot: AthenaBot): Promise<{ sent: number }> {
  const now = Date.now();
  let sent = 0;

  const remindKeys = (await kvKeys("remind:*")).slice(0, 50);
  for (const k of remindKeys) {
    const r = await kvGet<Reminder>(k);
    if (!r) continue;
    if (r.at > now) continue;
    await kvDel(k);
    try {
      await bot.api.sendMessage(r.chatId, `⏰ Reminder: ${r.text}\n(set by ${r.by})`);
      sent++;
    } catch (err) {
      console.error("reminder send failed", err);
    }
  }

  const today = quotaDay();
  const examKeys = (await kvKeys("exam:*")).slice(0, 50);
  for (const k of examKeys) {
    const e = await kvGet<ExamEntry>(k);
    if (!e) continue;
    const days = Math.ceil((Date.parse(`${e.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
    if (days < 0) {
      await kvDel(k);
      continue;
    }
    if (e.announcedOn === today) continue;
    const when = days === 0 ? "is TODAY 🚨" : days === 1 ? "is TOMORROW ⚠️" : `is in ${days} days`;
    try {
      await bot.api.sendMessage(e.chatId, `📅 ${e.name} ${when}. Good luck! 🍀`);
      sent++;
      e.announcedOn = today;
      await kvSet(k, e, 400 * 86_400);
    } catch (err) {
      console.error("exam countdown send failed", err);
    }
  }

  return { sent };
}
