import type { AthenaContext } from "../context.js";
import type { NextFunction } from "grammy";
import { getChatSettings, saveChatSettings } from "../store.js";

/** Remembers the serialized settings each context started with, so we only persist real changes. */
const originals = new WeakMap<object, string>();

/**
 * Loads per-chat settings onto every update coming from a group/supergroup.
 * Handlers may mutate `ctx.settings` freely; after the update finishes we
 * persist it back only if something actually changed.
 */
export function settingsMiddleware() {
  return async (ctx: AthenaContext, next: NextFunction): Promise<void> => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
      await next();
      return;
    }

    ctx.settings = await getChatSettings(chat.id);
    ctx.reloadSettings = async () => {
      ctx.settings = await getChatSettings(chat.id);
    };
    originals.set(ctx.settings, JSON.stringify(ctx.settings));

    try {
      await next();
    } finally {
      const before = originals.get(ctx.settings);
      if (before !== undefined && JSON.stringify(ctx.settings) !== before) {
        try {
          await saveChatSettings(chat.id, ctx.settings);
        } catch (err) {
          console.error("saveChatSettings failed", err);
        }
      }
    }
  };
}
