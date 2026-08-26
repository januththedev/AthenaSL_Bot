import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.length === 0) return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return n;
}

/**
 * All values are lazy getters so that importing this module never throws —
 * missing variables only fail when the feature that needs them runs,
 * with a clear message naming the variable.
 */
export const config = {
  get botToken(): string {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get webhookSecret(): string | undefined {
    return process.env["WEBHOOK_SECRET"];
  },
  /**
   * Neon Postgres connection string. Vercel's Neon Storage integration
   * injects POSTGRES_URL automatically; DATABASE_URL works too.
   */
  get postgresUrl(): string {
    const url =
      process.env["POSTGRES_URL"] ??
      process.env["DATABASE_URL"] ??
      process.env["NEON_DATABASE_URL"];
    if (!url) {
      throw new Error(
        "Missing database URL: set POSTGRES_URL (Vercel → Storage → Neon injects it) or DATABASE_URL.",
      );
    }
    return url;
  },
  get openrouterKey(): string {
    return required("OPENROUTER_API_KEY");
  },
  /**
   * All OpenRouter keys, in priority order: OPENROUTER_API_KEYS (comma or
   * whitespace separated) first, then the single OPENROUTER_API_KEY. When one
   * key is rate-limited the bot rotates to the next.
   */
  get openrouterKeys(): string[] {
    const list: string[] = [];
    const multi = process.env["OPENROUTER_API_KEYS"];
    if (multi) {
      for (const k of multi.split(/[\s,]+/)) {
        if (k.trim()) list.push(k.trim());
      }
    }
    const single = process.env["OPENROUTER_API_KEY"];
    if (single && single.trim()) list.push(single.trim());
    const unique = [...new Set(list)];
    if (unique.length === 0) {
      throw new Error("No OpenRouter API keys: set OPENROUTER_API_KEY or OPENROUTER_API_KEYS (comma-separated).");
    }
    return unique;
  },
  get openrouterModel(): string {
    return optional("OPENROUTER_MODEL", "minimax/minimax-m2.7:free");
  },
  /** Tried automatically when the primary model returns junk or is rate-limited. */
  get openrouterFallback(): string {
    return optional("OPENROUTER_MODEL_FALLBACK", "google/gemma-4-31b-it:free");
  },
  /** Pollinations.ai image model (flux is the general-purpose default). */
  get pollinationsModel(): string {
    return optional("POLLINATIONS_MODEL", "flux");
  },
  /** Per-user daily /ask limit in groups; admins are exempt. */
  get askDailyLimit(): number {
    return optionalInt("ASK_DAILY_LIMIT", 10);
  },
  /** Abort the OpenRouter call after this many ms. */
  get askTimeoutMs(): number {
    return optionalInt("ASK_TIMEOUT_MS", 45_000);
  },
  /** When "1", persist everything to a local JSON file instead of Postgres (dev/testing). */
  get useLocalStore(): boolean {
    return process.env["USE_LOCAL_STORE"] === "1";
  },
  get localStorePath(): string {
    return optional("LOCAL_STORE_PATH", "data/dev-store.json");
  },
};

export const BOT_VERSION = "1.0.0";
