import { getBot } from "../src/bot.js";
import { processDueReminders } from "../src/modules/reminders.js";

interface RequestLike {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
interface ResponseLike {
  status(code: number): { end(): void; json(body: unknown): void };
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

/**
 * Scheduler endpoint for production. Vercel Cron (see vercel.json) or any
 * external pinger must POST here with "Authorization: Bearer $CRON_SECRET".
 * Fires due /remind entries and daily /exam countdowns.
 */
export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const secret = process.env["CRON_SECRET"];
  const h = req.headers["authorization"];
  const auth = Array.isArray(h) ? (h[0] ?? "") : (h ?? "");
  if (!secret || auth !== `Bearer ${secret}`) {
    res.status(401).end();
    return;
  }
  try {
    await ensureInit();
    const result = await processDueReminders(getBot());
    res.status(200).json({ ok: true, sent: result.sent });
  } catch (err) {
    console.error("cron run failed", err);
    res.status(200).json({ ok: false });
  }
}
