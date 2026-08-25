import type { Context } from "grammy";
import type { ChatSettings } from "./store.js";

/** Custom context carrying per-chat settings loaded by the settings middleware. */
export interface AthenaContext extends Context {
  /** Populated for group/supergroup chats by middleware/settings.ts. */
  settings?: ChatSettings;
  reloadSettings(): Promise<void>;
}
