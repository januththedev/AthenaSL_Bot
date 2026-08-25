import type { Message } from "grammy/types";
import type { AthenaContext } from "../context.js";
import { isAdmin } from "./auth.js";
import { enforceLock } from "../modules/locks.js";
import { bumpFloodBucket } from "../store.js";
import { findFilterReply, filterCache } from "../modules/filters.js";
import { replyFirstNoteTag } from "../modules/notes.js";

/** True when the message is a command (/foo or !foo style). */
export function isCommand(msg: Message): boolean {
  const text = msg.text ?? msg.caption ?? "";
  if (text.startsWith("/") || text.startsWith("!")) return true;
  return (msg.entities ?? []).some((e) => e.type === "bot_command" && e.offset === 0);
}

const SERVICE_FIELDS = [
  "new_chat_members",
  "left_chat_member",
  "new_chat_title",
  "new_chat_photo",
  "delete_chat_photo",
  "group_chat_created",
  "supergroup_chat_created",
  "channel_chat_created",
  "migrate_to_chat_id",
  "migrate_from_chat_id",
  "pinned_message",
] as const;

function isServiceMessage(msg: Message): boolean {
  const m = msg as unknown as Record<string, unknown>;
  return SERVICE_FIELDS.some((f) => f in m);
}

// Throttle for flood notices: one per chat per 30s.
const lastFloodNotice = new Map<number, number>();

/**
 * The single catch-all middleware registered on `message` after all command
 * handlers and member events. Order:
 *   1. cleanservice   — delete service messages when enabled
 *   2. locks          — delete locked content types from non-admins
 *   3. antiflood      — temp-mute users exceeding the limit
 *   4. filters        — keyword auto-replies
 *   5. #note tags     — inline note retrieval
 */
export function enforcementPipeline() {
  return async (ctx: AthenaContext): Promise<void> => {
    const msg = ctx.msg;
    if (!msg || !ctx.chat) return;
    if (ctx.chat.type !== "group" && ctx.chat.type !== "supergroup") return;
    if (!ctx.settings) return;

    const chatId = ctx.chat.id;
    const from = msg.from;
    const senderIsAdmin = from ? await isAdmin(ctx, from.id) : false;

    // 1. Clean service messages (welcome/goodbye handlers already ran earlier).
    if (ctx.settings.cleanService && isServiceMessage(msg)) {
      try {
        await ctx.deleteMessage();
      } catch {
        // may be too old / missing rights
      }
      return;
    }

    if (!from) return;

    // 2. Locks
    if (ctx.settings.locks.length > 0 && !isCommand(msg)) {
      const handled = await enforceLock(
        chatId,
        from,
        senderIsAdmin,
        msg,
        ctx.settings.locks,
        () => ctx.deleteMessage(),
        async (text) => {
          await ctx.reply(text);
        },
      );
      if (handled) return;
    }

    // 3. Antiflood
    if (ctx.settings.antiflood.on && !from.is_bot && !senderIsAdmin && !isCommand(msg)) {
      try {
        const count = await bumpFloodBucket(chatId, from.id);
        if (count > ctx.settings.antiflood.limit) {
          const until = Math.floor(Date.now() / 1000) + ctx.settings.antiflood.muteMinutes * 60;
          try {
            await ctx.restrictChatMember(
              from.id,
              { can_send_messages: false },
              { until_date: until },
            );
            const now = Date.now();
            const last = lastFloodNotice.get(chatId) ?? 0;
            if (now - last > 30_000) {
              lastFloodNotice.set(chatId, now);
              await ctx.reply(
                `🌊 ${from.first_name ?? "User"} muted for ${ctx.settings.antiflood.muteMinutes} min (flooding).`,
              );
            }
          } catch (err) {
            console.error("antiflood restrict failed (needs ban rights)", err);
          }
          return;
        }
      } catch (err) {
        console.error("antiflood bucket failed", err);
      }
    }

    // 4. Filters (non-admins only)
    if (!senderIsAdmin && !from.is_bot && !isCommand(msg)) {
      const text = msg.text ?? msg.caption ?? "";
      if (text.length > 0 && !text.startsWith("/")) {
        const reply = findFilterReply(filterCache(ctx.chat.id), text);
        if (reply) {
          await ctx.reply(reply);
          return;
        }
      }
    }

    // 5. #tag notes
    if (msg.text) {
      await replyFirstNoteTag(ctx, msg.text);
    }
  };
}
