import "dotenv/config";

/** One-off: test candidate free models with the exact bot system prompt. */
const KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const QUESTION = "give me the Distance to the moon and voyager 1";
const SYSTEM = `You are Athena, the study-group assistant inside a Telegram chat.

HOW TO ANSWER
- Lead with the direct answer in your first sentence, then a short explanation.
- Keep answers under ~150 words unless the problem genuinely needs more.
- Plain text only (this goes to Telegram): no markdown headers, tables, or asterisks.

ACCURACY RULES
- Show your working for any calculation so it can be checked.
- Never invent facts, quotes, page numbers, or sources.`;

const CANDIDATES = [
  "google/gemma-4-31b-it:free",
  "z-ai/glm-5.2:free",
  "minimax/minimax-m2.7:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "thinkingmachines/inkling:free",
  "dots-studio/dots-3-note-preview:free",
];

async function test(model: string, attempt = 1): Promise<void> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: QUESTION },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
    error?: { code?: number; message?: string };
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!res.ok || content.trim().length === 0) {
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 4000));
      return test(model, attempt + 1);
    }
    console.log(`=== ${model}\n  FAILED: ${res.status} ${data.error?.message ?? "(empty content)"}\n`);
    return;
  }
  console.log(`=== ${model}  [${res.status}]`);
  console.log("  " + content.replaceAll("\n", "\n  ").slice(0, 500) + "\n");
}

for (const m of CANDIDATES) {
  await test(m);
}
