import { config } from "../config.js";
import { isDegenerate, stripThinking } from "../utils.js";
import type { AskResult } from "../openrouter.js";

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

/**
 * Groq provider: fast Llama models for the general chain, and compound models
 * with built-in web search + python code execution for routed questions.
 * Optional — disabled when GROQ_API_KEY is unset.
 */
export async function askGroq(
  question: string,
  system: string,
  model?: string,
): Promise<AskResult> {
  const key = config.groqKey;
  if (!key) return { ok: false, reason: "Groq is not configured (set GROQ_API_KEY)." };
  const chosen = model ?? config.groqModel;

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: chosen,
        messages: [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(config.askTimeoutMs),
    });
  } catch (err) {
    console.error("groq fetch failed", err);
    return { ok: false, reason: "unreachable" };
  }

  if (!res.ok) {
    console.error("groq status", res.status, chosen);
    return { ok: false, reason: `status ${res.status}` };
  }

  const data = (await res.json().catch(() => undefined)) as
    | { choices?: { message?: { content?: string | null } }[] }
    | undefined;
  const text = stripThinking(data?.choices?.[0]?.message?.content ?? "");
  if (text.length === 0 || isDegenerate(text)) {
    return { ok: false, reason: "empty" };
  }
  return { ok: true, text };
}
