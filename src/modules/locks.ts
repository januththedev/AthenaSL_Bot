import type { Message } from "grammy/types";
import { adminOnly } from "../middleware/auth.js";
import type { AthenaBot } from "../bot-types.js";
import { groupContext } from "../utils.js";

export const LOCK_TYPES = [
  "photo",
  "video",
  "animation",
  "audio",
  "voice",
  "videonote",
  "sticker",
  "document",
  "contact",
  "location",
  "poll",
  "url",
  "forward",
  "inline",
  "all",
] as const;

export type LockType = (typeof LOCK_TYPES)[number];

function hasEntitiesUrl(msg: Message): boolean {
  const lists = [msg.entities, msg.caption_entities];
  return lists.some((list) =>
    (list ?? []).some((e) => e.type === "url" || e.type === "text_link"),
  );
}

/** Pure predicate: does this message violate the given lock type? */
export function messageMatchesLock(msg: Message, lock: string): boolean {
  switch (lock) {
    case "photo":
      return Boolean(msg.photo);
    case "video":
      return Boolean(msg.video);
    case "animation":
      return Boolean(msg.animation);
    case "audio":
      return Boolean(msg.audio);
    case "voice":
      return Boolean(msg.voice);
    case "videonote":
      return Boolean(msg.video_note);
    case "sticker":
      return Boolean(msg.sticker);
    case "document":
      return Boolean(msg.document);
    case "contact":
      return Boolean(msg.contact);
    case "location":
      return Boolean(msg.location);
    case "poll":
      return Boolean(msg.poll);
    case "url":
      return hasEntitiesUrl(msg);
    case "forward": {
      const m = msg as unknown as Record<string, unknown>;
      return "forward_origin" in m || "forward_from" in m || "forward_sender_name" in m;
    }
    case "inline":
      return Boolean(msg.via_bot);
    case "all":
      return (
        Boolean(
          msg.photo ||
            msg.video ||
            msg.animation ||
            msg.audio ||
            msg.voice ||
            msg.video_note ||
            msg.sticker ||
            msg.document ||
            msg.contact ||
            msg.location ||
            msg.poll,
        )
      );
    default:
      return false;
  }
}

const LOCK_HELP =
  "Lockable types: " +
  LOCK_TYPES.map((t) => `\`${t}\``).join(", ") +
  ".";

export function registerLockCommands(bot: AthenaBot): void {
  const parseTypes = (args: string): { valid: LockType[]; invalid: string[] } => {
    const words = args.toLowerCase().split(/[\s,]+/).filter(Boolean);
    const valid: LockType[] = [];
    const invalid: string[] = [];
    for (const w of words) {
      if ((LOCK_TYPES as readonly string[]).includes(w)) valid.push(w as LockType);
      else invalid.push(w);
    }
    return { valid, invalid };
  };

  bot.command("lock", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const { valid, invalid } = parseTypes(ctx.match ?? "");
    if (valid.length === 0) {
      const notice =
        invalid.length > 0
          ? `⚠️ Unknown types: ${invalid.join(", ")}.`
          : "Usage: /lock <type…>";
      await ctx.reply(`${notice}\n${LOCK_HELP}`);
      return;
    }
    let added = 0;
    for (const t of valid) {
      if (!g.settings.locks.includes(t)) {
        g.settings.locks.push(t);
        added++;
      }
    }
    const notice =
      added > 0
        ? `🔒 Locked: ${valid.join(", ")}.`
        : "Those were already locked.";
    if (invalid.length > 0) {
      await ctx.reply(`${notice}\n⚠️ Unknown types ignored: ${invalid.join(", ")}.\n${LOCK_HELP}`);
    } else {
      await ctx.reply(notice);
    }
  }));

  bot.command("unlock", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const { valid } = parseTypes(ctx.match ?? "");
    if (valid.length === 0) {
      await ctx.reply(`Usage: /unlock <type…>\n${LOCK_HELP}`);
      return;
    }
    g.settings.locks = g.settings.locks.filter((l) => !valid.includes(l as LockType));
    await ctx.reply(`🔓 Unlocked: ${valid.join(", ")}.`);
  }));

  bot.command("locks", adminOnly(async (ctx) => {
    const g = await groupContext(ctx);
    if (!g) return;
    const locked = g.settings.locks;
    await ctx.reply(
      locked.length > 0 ? `Currently locked: ${locked.join(", ")}` : "Nothing is locked.",
    );
  }));
}

// In-memory notice throttle: at most one lock notice per chat per 30 seconds.
const lastNotice = new Map<number, number>();

/**
 * Enforcement step for the guards pipeline (see middleware/guards.ts).
 * Deletes locked content from non-admin senders; returns true when a
 * violation was found and handled.
 */
export async function enforceLock(
  chatId: number,
  sender: { id: number; is_bot: boolean },
  isAdminUser: boolean,
  msg: Message,
  locks: string[],
  apiDelete: () => Promise<unknown>,
  notify: (text: string) => Promise<void>,
): Promise<boolean> {
  if (isAdminUser || sender.is_bot || locks.length === 0) return false;
  const hit = locks.find((l) => messageMatchesLock(msg, l));
  if (!hit) return false;
  try {
    await apiDelete();
  } catch (err) {
    console.error("lock delete failed (is the bot an admin?)", err);
    await notify("🔒 Locked content detected, but I need admin rights to remove it.");
    return true;
  }
  const now = Date.now();
  const last = lastNotice.get(chatId) ?? 0;
  if (now - last > 30_000) {
    lastNotice.set(chatId, now);
    await notify(`🚫 Removed: \`${hit}\` is locked here.`);
  }
  return true;
}
