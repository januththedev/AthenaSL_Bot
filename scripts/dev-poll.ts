import { getBot } from "../src/bot.js";

/**
 * Local development runner: same bot instance as production, driven by
 * long-polling instead of a webhook. Needs TELEGRAM_BOT_TOKEN, the Upstash
 * pair and OPENROUTER_API_KEY in .env — but not WEBHOOK_SECRET/PUBLIC_BASE_URL.
 */
async function main() {
  const bot = getBot();
  bot.catch((err) => console.error("bot error", err));
  bot.start({
    drop_pending_updates: true,
    onStart: (me) => console.log(`Athena polling as @${me.username} — Ctrl+C to stop`),
  });

  const shutdown = () => {
    console.log("\nStopping…");
    bot.stop();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
