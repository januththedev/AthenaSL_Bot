import { config } from "../src/config.js";

const API = "https://api.telegram.org";

const ALLOWED_UPDATES = ["message", "callback_query", "my_chat_member"] as const;

async function call(method: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${API}/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!data.ok) throw new Error(`${method} failed: ${data.description ?? res.status}`);
  return data.result;
}

async function main() {
  const del = process.argv.includes("--delete");
  if (del) {
    await call("deleteWebhook", { drop_pending_updates: true });
    console.log("Webhook deleted.");
    return;
  }

  const argUrl = process.argv.find((a) => a.startsWith("http"));
  const base = (argUrl ?? process.env["PUBLIC_BASE_URL"] ?? "").replace(/\/+$/, "");
  if (!base) {
    console.error("Pass your deployment URL: npm run set-webhook -- https://your-app.vercel.app");
    process.exit(1);
  }
  const secret = config.webhookSecret;
  if (!secret || secret.length < 8) {
    console.error("Set WEBHOOK_SECRET in the environment first (random, A-Za-z0-9_-).");
    process.exit(1);
  }

  const url = `${base}/api/webhook`;
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: true,
  });
  console.log(`Webhook set to ${url}`);
  const info = await call("getWebhookInfo", {});
  console.log(JSON.stringify(info, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
