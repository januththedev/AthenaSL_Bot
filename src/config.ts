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
  get upstashUrl(): string {
    return required("UPSTASH_REDIS_REST_URL");
  },
  get upstashToken(): string {
    return required("UPSTASH_REDIS_REST_TOKEN");
  },
  get openrouterKey(): string {
    return required("OPENROUTER_API_KEY");
  },
  get openrouterModel(): string {
    return optional("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free");
  },
  /** Per-user daily /ask limit in groups; admins are exempt. */
  get askDailyLimit(): number {
    return optionalInt("ASK_DAILY_LIMIT", 10);
  },
  /** Abort the OpenRouter call after this many ms. */
  get askTimeoutMs(): number {
    return optionalInt("ASK_TIMEOUT_MS", 45_000);
  },
  /** When "1", persist everything to a local JSON file instead of Upstash (dev/testing). */
  get useLocalStore(): boolean {
    return process.env["USE_LOCAL_STORE"] === "1";
  },
  get localStorePath(): string {
    return optional("LOCAL_STORE_PATH", "data/dev-store.json");
  },
};

export const BOT_VERSION = "1.0.0";
