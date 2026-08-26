import { waitUntil } from "@vercel/functions";
import { getBot } from "../src/bot.js";
import type { Update } from "grammy/types";

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}
interface ResponseLike {
  status(code: number): { end(): void; json(body: unknown): void };
}

function header(req: RequestLike, name: string): string {
  const v = req.headers[name];
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

// Blocks Telegram's retry-storm pattern: when a previous attempt ran long,
// Telegram re-delivers the update — warm instances see the same update_id
// again and skip it.
const processedUpdates = new Set<number>();
const MAX_TRACKED = 600;

function markProcessed(updateId: number): boolean {
  if (processedUpdates.has(updateId)) return false;
  processedUpdates.add(updateId);
  if (processedUpdates.size > MAX_TRACKED) {
    // Set preserves insertion order — evict the oldest half.
    let evicted = 0;
    for (const id of processedUpdates) {
      processedUpdates.delete(id);
      if (++evicted >= MAX_TRACKED / 2) break;
    }
  }
  return true;
}

// grammY needs bot info loaded once per instance before handleUpdate.
let initPromise: Promise<void> | undefined;

async function ensureInit(): Promise<void> {
  const bot = getBot();
  if (!initPromise) {
    initPromise = bot.init().catch((err) => {
      initPromise = undefined;
      throw err;
    });
  }
  await initPromise;
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "athena-bot" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  // Telegram round-trips the secret_token given to setWebhook; reject anything else.
  const secret = process.env["WEBHOOK_SECRET"];
  const received = header(req, "x-telegram-bot-api-secret-token");
  if (!secret || received !== secret) {
    console.error("webhook rejected: bad or missing secret token");
    res.status(401).end();
    return;
  }

  const update = req.body as Update;
  const updateId = (update as { update_id?: number } | null)?.update_id;
  if (typeof updateId === "number" && !markProcessed(updateId)) {
    // Telegram retry of an update we already accepted — do not process twice.
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  try {
    // Answer Telegram immediately (its client gives up after ~60s and retries,
    // which used to duplicate slow AI answers), then keep processing in the
    // background via waitUntil.
    await ensureInit();
    waitUntil(
      getBot()
        .handleUpdate(update)
        .catch((err: unknown) => console.error("background update failed", err)),
    );
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook update failed", err);
    res.status(200).json({ ok: true });
  }
}
