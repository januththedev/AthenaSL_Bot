import { config } from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const SYSTEM_PROMPT = `You are Athena, the study-group assistant inside a Telegram chat.

HOW TO ANSWER
- Lead with the direct answer in your first sentence, then a short explanation.
- For math, science, or coding: show the key steps as numbered lines so students can follow, skipping trivial arithmetic.
- Keep answers under ~150 words unless the problem genuinely needs more.
- Plain text only (this goes to Telegram): no markdown headers, tables, or asterisks. Use dashes or "1. 2. 3." for lists.
- Define jargon in one short line the first time you use it.

ACCURACY RULES
- Show your working for any calculation so it can be checked.
- If you are unsure, separate what you know from what you are not sure of, and say how to verify (textbook, formula sheet, teacher). Never invent facts, quotes, page numbers, or sources.
- If the question is ambiguous, state your one-line assumption and answer anyway instead of asking follow-ups.

STYLE
- No filler ("Great question", "As an AI...") and never repeat the question back.
- Friendly, encouraging, classroom-appropriate.
- Offer a next step only when it clearly helps (e.g., "Want the full derivation? Reply /ask explain step 3 in more detail").`;

export type AskResult = { ok: true; text: string } | { ok: false; reason: string };

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
}

/** Remove <think>…</think> reasoning blocks some free models emit before answering. Pure. */
export function stripThinking(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think\s*>/gi, "");
  // Unterminated <think> block (generation cut off): drop everything from the tag onward.
  const open = t.toLowerCase().indexOf("<think>");
  if (open !== -1) t = t.slice(0, open);
  return t.trim();
}

/**
 * Split long text into Telegram-safe chunks, preferring paragraph/line breaks.
 * Pure.
 */
export function chunkText(text: string, max = 3900): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    let cut = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) parts.push(rest);
  return parts;
}

function failureReason(status: number, bodyMessage?: string): string {
  switch (status) {
    case 401:
      return "OpenRouter rejected the API key (401). Check OPENROUTER_API_KEY.";
    case 402:
      return "The OpenRouter account is out of credits (402). Free models need ≥10 credits purchased for the higher daily quota — or try again tomorrow.";
    case 429:
      return "Rate limited by OpenRouter (429). Too many requests right now — try again in a minute.";
    default:
      return `OpenRouter request failed (${status})${bodyMessage ? `: ${bodyMessage}` : "."}`;
  }
}

export async function askOpenRouter(question: string): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openrouterKey}`,
        "Content-Type": "application/json",
        "X-Title": "Athena Telegram Bot",
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(config.askTimeoutMs),
    });
  } catch (err) {
    console.error("openrouter fetch failed", err);
    return { ok: false, reason: "Could not reach OpenRouter (network timeout?). Try again." };
  }

  let body: ChatCompletionResponse | undefined;
  try {
    body = (await res.json()) as ChatCompletionResponse;
  } catch {
    // non-JSON error body
  }

  if (!res.ok) {
    return { ok: false, reason: failureReason(res.status, body?.error?.message) };
  }

  const raw = body?.choices?.[0]?.message?.content ?? "";
  const text = stripThinking(raw);
  if (text.length === 0) {
    return { ok: false, reason: `The model (${config.openrouterModel}) returned an empty answer.` };
  }
  return { ok: true, text };
}
