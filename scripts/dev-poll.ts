import { getBot } from "../src/bot.js";
import { processDueReminders } from "../src/modules/reminders.js";

/**
 * Local development runner: same bot instance as production, driven by
 * long-polling instead of a webhook. Needs TELEGRAM_BOT_TOKEN and
 * OPENROUTER_API_KEY in .env — plus USE_LOCAL_STORE=1 or POSTGRES_URL.
 * Also runs the reminder/exam scheduler every 60s (what Vercel Cron does in prod).
 */
async function main() {
  const bot = getBot();
  bot.catch((err) => console.error("bot error", err.error ?? err));
  bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`Athena polling as @${me.username} — Ctrl+C to stop`),
  });

  const tick = () =>
    processDueReminders(bot).catch((err) => console.error("scheduler tick failed", err));
  const scheduler = setInterval(tick, 60_000);
  const first = setTimeout(tick, 5_000);

  const shutdown = () => {
    console.log("\nStopping…");
    clearInterval(scheduler);
    clearTimeout(first);
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
