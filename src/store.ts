import { Redis } from "@upstash/redis";
import { config } from "./config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WelcomeCfg {
  enabled: boolean;
  text: string | null;
}

export type WarnAction = "ban" | "kick" | "mute";

export interface ChatSettings {
  welcome: WelcomeCfg;
  goodbye: WelcomeCfg;
  rules: string | null;
  warnLimit: number;
  warnAction: WarnAction;
  antiflood: { on: boolean; limit: number; muteMinutes: number };
  locks: string[];
  cleanService: boolean;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  welcome: { enabled: true, text: null },
  goodbye: { enabled: true, text: null },
  rules: null,
  warnLimit: 3,
  warnAction: "ban",
  antiflood: { on: false, limit: 5, muteMinutes: 10 },
  locks: [],
  cleanService: false,
};

export interface WarnEntry {
  reason: string;
  by: string;
  at: number;
}

/** Merge a stored (possibly partial/legacy) settings object onto the defaults. Pure. */
export function mergeSettings(raw: unknown): ChatSettings {
  const d = DEFAULT_SETTINGS;
  if (raw === null || typeof raw !== "object") return structuredClone(d);
  const r = raw as Record<string, unknown>;
  const welcome = r["welcome"] as Partial<WelcomeCfg> | undefined;
  const goodbye = r["goodbye"] as Partial<WelcomeCfg> | undefined;
  const antiflood = r["antiflood"] as
    | Partial<ChatSettings["antiflood"]>
    | undefined;
  const warnAction =
    r["warnAction"] === "kick" || r["warnAction"] === "mute"
      ? r["warnAction"]
      : d.warnAction;
  return {
    welcome: {
      enabled: typeof welcome?.enabled === "boolean" ? welcome.enabled : d.welcome.enabled,
      text: typeof welcome?.text === "string" ? welcome.text : d.welcome.text,
    },
    goodbye: {
      enabled: typeof goodbye?.enabled === "boolean" ? goodbye.enabled : d.goodbye.enabled,
      text: typeof goodbye?.text === "string" ? goodbye.text : d.goodbye.text,
    },
    rules: typeof r["rules"] === "string" ? r["rules"] : d.rules,
    warnLimit:
      typeof r["warnLimit"] === "number" && r["warnLimit"] > 0
        ? Math.floor(r["warnLimit"])
        : d.warnLimit,
    warnAction,
    antiflood: {
      on: typeof antiflood?.on === "boolean" ? antiflood.on : d.antiflood.on,
      limit:
        typeof antiflood?.limit === "number" && antiflood.limit > 0
          ? Math.floor(antiflood.limit)
          : d.antiflood.limit,
      muteMinutes:
        typeof antiflood?.muteMinutes === "number" && antiflood.muteMinutes > 0
          ? Math.floor(antiflood.muteMinutes)
          : d.antiflood.muteMinutes,
    },
    locks: Array.isArray(r["locks"])
      ? (r["locks"].filter((x): x is string => typeof x === "string"))
      : d.locks,
    cleanService:
      typeof r["cleanService"] === "boolean" ? r["cleanService"] : d.cleanService,
  };
}

// ---------------------------------------------------------------------------
// Redis client (lazy so importing this module never requires env vars)
// ---------------------------------------------------------------------------

let client: Redis | undefined;

function redis(): Redis {
  if (!client) {
    client = new Redis({
      url: config.upstashUrl,
      token: config.upstashToken,
    });
  }
  return client;
}

// ---------------------------------------------------------------------------
// Chat settings
// ---------------------------------------------------------------------------

const settingsKey = (chatId: number) => `chat:${chatId}:cfg`;

export async function getChatSettings(chatId: number): Promise<ChatSettings> {
  try {
    const raw = await redis().get(settingsKey(chatId));
    return mergeSettings(raw);
  } catch (err) {
    console.error("getChatSettings failed", err);
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export async function saveChatSettings(
  chatId: number,
  settings: ChatSettings,
): Promise<void> {
  await redis().set(settingsKey(chatId), settings);
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

const warnsKey = (chatId: number, userId: number) =>
  `chat:${chatId}:warns:${userId}`;

async function readWarns(chatId: number, userId: number): Promise<WarnEntry[]> {
  const raw = await redis().get<WarnEntry[]>(warnsKey(chatId, userId));
  return Array.isArray(raw) ? raw : [];
}

export async function getWarns(chatId: number, userId: number): Promise<WarnEntry[]> {
  try {
    return await readWarns(chatId, userId);
  } catch (err) {
    console.error("getWarns failed", err);
    return [];
  }
}

/** Append a warning; returns the new total count for that user. */
export async function addWarn(
  chatId: number,
  userId: number,
  entry: WarnEntry,
): Promise<number> {
  const list = await readWarns(chatId, userId);
  list.push(entry);
  await redis().set(warnsKey(chatId, userId), list);
  return list.length;
}

/** Remove the warning at `index` (0-based); returns true if something was removed. */
export async function removeWarn(
  chatId: number,
  userId: number,
  index: number,
): Promise<boolean> {
  const list = await readWarns(chatId, userId);
  if (index < 0 || index >= list.length) return false;
  list.splice(index, 1);
  if (list.length === 0) await redis().del(warnsKey(chatId, userId));
  else await redis().set(warnsKey(chatId, userId), list);
  return true;
}

export async function clearWarns(chatId: number, userId: number): Promise<void> {
  await redis().del(warnsKey(chatId, userId));
}

// ---------------------------------------------------------------------------
// Notes (#tag retrieval + /get)
// ---------------------------------------------------------------------------

const notePrefix = (chatId: number) => `chat:${chatId}:note:`;
const noteKey = (chatId: number, name: string) => `${notePrefix(chatId)}${name.toLowerCase()}`;

export async function setNote(chatId: number, name: string, content: string): Promise<void> {
  await redis().set(noteKey(chatId, name), content);
}

export async function getNote(chatId: number, name: string): Promise<string | null> {
  try {
    return await redis().get<string>(noteKey(chatId, name));
  } catch (err) {
    console.error("getNote failed", err);
    return null;
  }
}

export async function deleteNote(chatId: number, name: string): Promise<number> {
  return redis().del(noteKey(chatId, name));
}

export async function listNotes(chatId: number): Promise<string[]> {
  try {
    const keys = await redis().keys(`${notePrefix(chatId)}*`);
    return keys.map((k) => k.slice(notePrefix(chatId).length)).sort();
  } catch (err) {
    console.error("listNotes failed", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Filters (keyword -> auto-reply)
// ---------------------------------------------------------------------------

const filterPrefix = (chatId: number) => `chat:${chatId}:filter:`;
const filterKey = (chatId: number, kw: string) => `${filterPrefix(chatId)}${kw.toLowerCase()}`;

export interface FilterEntry {
  keyword: string;
  reply: string;
}

export async function setFilter(chatId: number, keyword: string, reply: string): Promise<void> {
  await redis().set(filterKey(chatId, keyword), { keyword, reply });
}

export async function deleteFilter(chatId: number, keyword: string): Promise<number> {
  return redis().del(filterKey(chatId, keyword));
}

export async function getFilter(chatId: number, keyword: string): Promise<FilterEntry | null> {
  try {
    return await redis().get<FilterEntry>(filterKey(chatId, keyword));
  } catch (err) {
    console.error("getFilter failed", err);
    return null;
  }
}

export async function listFilters(chatId: number): Promise<FilterEntry[]> {
  try {
    const keys = await redis().keys(`${filterPrefix(chatId)}*`);
    const entries = await Promise.all(
      keys.map((k) => redis().get<FilterEntry>(k).catch(() => null)),
    );
    return entries.filter((v): v is FilterEntry => v !== null);
  } catch (err) {
    console.error("listFilters failed", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Antiflood sliding-ish window: one counter per user per 10-second bucket
// ---------------------------------------------------------------------------

/** Returns how many messages this user has sent in the current 10s bucket. */
export async function bumpFloodBucket(chatId: number, userId: number): Promise<number> {
  const bucket = Math.floor(Date.now() / 10_000);
  const key = `chat:${chatId}:flood:${userId}:${bucket}`;
  const count = await redis().incr(key);
  if (count === 1) await redis().expire(key, 30);
  return count;
}

export function floodBucketWindowSeconds(): number {
  return 10;
}

// ---------------------------------------------------------------------------
// /ask daily quota
// ---------------------------------------------------------------------------

export const askQuotaKey = (chatId: number, userId: number, day: string) =>
  `ask:${chatId}:${userId}:${day}`;

/** ISO date (UTC yyyy-mm-dd) used as the quota day bucket. */
export function quotaDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Increment and return the number of /ask calls used by this user today.
 * Second call only exists to make the counter testable.
 */
export async function incrAskUsage(chatId: number, userId: number): Promise<number> {
  const key = askQuotaKey(chatId, userId, quotaDay());
  const used = await redis().incr(key);
  if (used === 1) await redis().expire(key, 60 * 60 * 48);
  return used;
}
