import { config } from "../src/config.js";

/** Registers the command menu users see in Telegram's UI. */
const commands = [
  { command: "ask", description: "Ask the AI — auto web search & python when needed" },
  { command: "start", description: "Introduce the bot" },
  { command: "help", description: "All commands explained" },
  { command: "remind", description: "Set a reminder (e.g. /remind 1h30m submit lab)" },
  { command: "exam", description: "Set an exam countdown (admins)" },
  { command: "quiz", description: "Start a 5-question quiz on a topic" },
  { command: "draw", description: "Generate an image from a description" },
  { command: "chart", description: "Precise data chart from a question" },
  { command: "summarize", description: "Summarize a replied message or link" },
  { command: "recap", description: "AI recap of today's chat" },
  { command: "resources", description: "Links shared in this group" },
  { command: "rules", description: "Show the group rules" },
  { command: "notes", description: "List saved notes" },
  { command: "persona", description: "Show this group's custom AI style" },
  { command: "warnings", description: "Show warnings (reply to a user)" },
  { command: "info", description: "User info (reply or @user)" },
  { command: "id", description: "Show chat/user IDs" },
  { command: "admins", description: "List group admins" },
  { command: "report", description: "Report a message to admins (reply)" },
  { command: "about", description: "About this bot" },
];

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setMyCommands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ commands }),
  });
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? "setMyCommands failed");
  console.log(`Registered ${commands.length} commands.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
