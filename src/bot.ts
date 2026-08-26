import { Bot } from "grammy";
import { config } from "./config.js";
import type { AthenaContext } from "./context.js";
import type { AthenaBot } from "./bot-types.js";
import { settingsMiddleware } from "./middleware/settings.js";
import { enforcementPipeline } from "./middleware/guards.js";

import { registerMisc } from "./modules/misc.js";
import { registerAsk } from "./modules/ask.js";
import { registerRules } from "./modules/rules.js";
import { registerWelcome } from "./modules/welcome.js";
import { registerWarns } from "./modules/warns.js";
import { registerLockCommands } from "./modules/locks.js";
import { registerPurge } from "./modules/purge.js";
import { registerNoteCommands } from "./modules/notes.js";
import { registerFilterCommands } from "./modules/filters.js";
import { registerFloodCommands } from "./modules/flood.js";
import { registerInfo } from "./modules/info.js";
import { registerPersona } from "./modules/persona.js";
import { registerReminders } from "./modules/reminders.js";
import { registerQuiz } from "./modules/quiz.js";
import { registerSummarize } from "./modules/summarize.js";
import { registerRecap } from "./modules/recap.js";
import { registerDraw } from "./modules/images.js";
import { registerChart } from "./modules/charts.js";

let cached: AthenaBot | undefined;

/**
 * Singleton bot instance (warm serverless invocations reuse it).
 * Registration order matters:
 *   settings → commands & callbacks → member events (welcome) → catch-all guards.
 */
export function getBot(): AthenaBot {
  if (cached) return cached;

  const bot = new Bot<AthenaContext>(config.botToken);
  bot.catch((err) => console.error("bot error", err.error ?? err));

  bot.use(settingsMiddleware());

  registerMisc(bot);
  registerAsk(bot);
  registerPersona(bot);

  // Study tools
  registerReminders(bot);
  registerQuiz(bot);
  registerSummarize(bot);
  registerRecap(bot);
  registerDraw(bot);
  registerChart(bot);

  registerRules(bot);
  registerLockCommands(bot);
  registerPurge(bot);
  registerWarns(bot); // also registers the warn-removal callback
  registerNoteCommands(bot);
  registerFilterCommands(bot);
  registerFloodCommands(bot);
  registerInfo(bot);

  // Welcome/goodbye/bot-lock run before the guard pipeline so greetings are
  // sent even when clean-service would delete the join message.
  registerWelcome(bot);

  bot.on("message", enforcementPipeline());

  cached = bot;
  return bot;
}
