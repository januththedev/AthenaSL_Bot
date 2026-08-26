import { config } from "../src/config.js";

/** Registers the command menu users see in Telegram's UI. */
const commands = [
  { command: "ask", description: "Ask the AI — or reply to a message with /ask" },
  { command: "start", description: "Introduce the bot" },
  { command: "help", description: "All commands explained" },
  { command: "rules", description: "Show the group rules" },
  { command: "notes", description: "List saved notes" },
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
