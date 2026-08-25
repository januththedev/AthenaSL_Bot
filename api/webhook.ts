import { getBot } from "../src/bot.js";
import type { Update } from "grammy/types";

// Vercel injects compatible req/res objects; we avoid importing @vercel/node
// just for types by describing the small surface we use.
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

  try {
    await ensureInit();
    await getBot().handleUpdate(req.body as Update);
    // Always 200 so Telegram doesn't retry-storm on our own handler bugs.
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("webhook update failed", err);
    res.status(200).json({ ok: true });
  }
}
