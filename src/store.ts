import { Redis } from "@upstash/redis";
import fs from "node:fs";
import path from "node:path";
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
  persona: string | null;
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
  persona: null,
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
    persona: typeof r["persona"] === "string" ? r["persona"] : d.persona,
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
// Storage backends
// ---------------------------------------------------------------------------

interface StoreBackend {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

class UpstashBackend implements StoreBackend {
  private client: Redis;
  constructor() {
    this.client = new Redis({ url: config.upstashUrl, token: config.upstashToken });
  }
  get<T>(key: string) {
    return this.client.get<T>(key);
  }
  set(key: string, value: unknown) {
    return this.client.set(key, value as never).then(() => undefined);
  }
  del(key: string) {
    return this.client.del(key);
  }
  incr(key: string) {
    return this.client.incr(key);
  }
  expire(key: string, seconds: number) {
    return this.client.expire(key, seconds);
  }
  keys(pattern: string) {
    return this.client.keys(pattern);
  }
}

interface LocalEntry {
  v: unknown;
  /** Epoch ms after which the entry is treated as missing (mirrors Redis TTLs). */
  exp?: number;
}

/**
 * File-backed backend for local development/testing: same semantics as the
 * Redis subset we use, persisted to a JSON file so data survives restarts.
 */
export class LocalBackend implements StoreBackend {
  private data = new Map<string, LocalEntry>();

  constructor(private file: string) {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Record<string, LocalEntry>;
      for (const [k, v] of Object.entries(parsed)) this.data.set(k, v);
    } catch {
      // first run or unreadable file — start empty
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data), null, 1));
    fs.renameSync(tmp, this.file);
  }

  private entry(key: string): LocalEntry | undefined {
    const e = this.data.get(key);
    if (e?.exp !== undefined && e.exp < Date.now()) {
      this.data.delete(key);
      this.save();
      return undefined;
    }
    return e;
  }

  async get<T>(key: string): Promise<T | null> {
    const e = this.entry(key);
    return e ? (e.v as T) : null;
  }

  async set(key: string, value: unknown): Promise<void> {
    const prev = this.data.get(key);
    this.data.set(key, { v: value, exp: prev?.exp });
    this.save();
  }

  async del(key: string): Promise<number> {
    const existed = this.data.delete(key);
    if (existed) this.save();
    return existed ? 1 : 0;
  }

  async incr(key: string): Promise<number> {
    const e = this.entry(key);
    const next = (typeof e?.v === "number" ? e.v : 0) + 1;
    this.data.set(key, { v: next, exp: e?.exp });
    this.save();
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const e = this.data.get(key);
    if (!e) return 0;
    e.exp = Date.now() + seconds * 1000;
    this.save();
    return 1;
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(
      "^" +
        pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
    );
    return [...this.data.keys()].filter((k) => this.entry(k) !== undefined && regex.test(k));
  }
}

let backendInstance: StoreBackend | undefined;

function backend(): StoreBackend {
  if (!backendInstance) {
    backendInstance = config.useLocalStore
      ? new LocalBackend(config.localStorePath)
      : new UpstashBackend();
  }
  return backendInstance;
}

// ---------------------------------------------------------------------------
// Generic kv access (used by study-tool modules: reminders, quiz, recap)
// ---------------------------------------------------------------------------

export async function kvGet<T>(key: string): Promise<T | null> {
  return backend().get<T>(key);
}

export async function kvSet(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  await backend().set(key, value);
  if (ttlSeconds) await backend().expire(key, ttlSeconds);
}

export async function kvDel(key: string): Promise<number> {
  return backend().del(key);
}

export async function kvKeys(pattern: string): Promise<string[]> {
  return backend().keys(pattern);
}

// ---------------------------------------------------------------------------
// Chat settings
// ---------------------------------------------------------------------------

const settingsKey = (chatId: number) => `chat:${chatId}:cfg`;

export async function getChatSettings(chatId: number): Promise<ChatSettings> {
  try {
    const raw = await backend().get(settingsKey(chatId));
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
  await backend().set(settingsKey(chatId), settings);
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

const warnsKey = (chatId: number, userId: number) =>
  `chat:${chatId}:warns:${userId}`;

async function readWarns(chatId: number, userId: number): Promise<WarnEntry[]> {
  const raw = await backend().get<WarnEntry[]>(warnsKey(chatId, userId));
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
  await backend().set(warnsKey(chatId, userId), list);
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
  if (list.length === 0) await backend().del(warnsKey(chatId, userId));
  else await backend().set(warnsKey(chatId, userId), list);
  return true;
}

export async function clearWarns(chatId: number, userId: number): Promise<void> {
  await backend().del(warnsKey(chatId, userId));
}

// ---------------------------------------------------------------------------
// Notes (#tag retrieval + /get)
// ---------------------------------------------------------------------------

const notePrefix = (chatId: number) => `chat:${chatId}:note:`;
const noteKey = (chatId: number, name: string) => `${notePrefix(chatId)}${name.toLowerCase()}`;

export async function setNote(chatId: number, name: string, content: string): Promise<void> {
  await backend().set(noteKey(chatId, name), content);
}

export async function getNote(chatId: number, name: string): Promise<string | null> {
  try {
    const v = await backend().get<string>(noteKey(chatId, name));
    return v ?? null;
  } catch (err) {
    console.error("getNote failed", err);
    return null;
  }
}

export async function deleteNote(chatId: number, name: string): Promise<number> {
  return backend().del(noteKey(chatId, name));
}

export async function listNotes(chatId: number): Promise<string[]> {
  try {
    const keys = await backend().keys(`${notePrefix(chatId)}*`);
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
  await backend().set(filterKey(chatId, keyword), { keyword, reply });
}

export async function deleteFilter(chatId: number, keyword: string): Promise<number> {
  return backend().del(filterKey(chatId, keyword));
}

export async function getFilter(chatId: number, keyword: string): Promise<FilterEntry | null> {
  try {
    return await backend().get<FilterEntry>(filterKey(chatId, keyword));
  } catch (err) {
    console.error("getFilter failed", err);
    return null;
  }
}

export async function listFilters(chatId: number): Promise<FilterEntry[]> {
  try {
    const keys = await backend().keys(`${filterPrefix(chatId)}*`);
    const entries = await Promise.all(
      keys.map((k) => backend().get<FilterEntry>(k).catch(() => null)),
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
  const count = await backend().incr(key);
  if (count === 1) await backend().expire(key, 30);
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

/** Increment and return the number of /ask calls used by this user today. */
export async function incrAskUsage(chatId: number, userId: number): Promise<number> {
  const key = askQuotaKey(chatId, userId, quotaDay());
  const used = await backend().incr(key);
  if (used === 1) await backend().expire(key, 60 * 60 * 48);
  return used;
}
