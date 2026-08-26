import { config } from "./config.js";
import { askGroq } from "./modules/groq.js";
import { chunkText, isDegenerate, stripThinking } from "./utils.js";

export { chunkText, isDegenerate, stripThinking };

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const SYSTEM_PROMPT = `You are Athena, a study-group assistant inside a Telegram chat. Your users are school students in Sri Lanka.

LANGUAGE (most important rule)
- Always answer in the SAME language the question was written in. English question → English answer. Sinhala → Sinhala. Tamil → Tamil.
- Many users type Sinhala or Tamil using ENGLISH letters (Singlish/Tanglish), e.g. "mama dananna one", "eeka mokakda", "epa comment ekak danna". Recognize this as Sinhala (or Tamil) and answer in that language's normal script.
- Never switch languages unless the user explicitly asks for a different one.
- For technical terms, give the local word once with the English term in brackets, e.g. "ගුරුත්වාකර්ෂණය (gravity)".

BEGINNER STYLE (second most important)
- Write for a complete beginner: short sentences, everyday words, and one easy example or analogy for anything new.
- Avoid jargon; if a technical term is needed, explain it in one simple line.
- Keep it SHORT — a few sentences or a few bullets. Use simple words, never simplified facts.

HOW TO ANSWER
- Lead with the direct answer in your first sentence, then a short explanation.
- For math, physics or engineering: state the formula(s) and constants you use (e.g. "escape velocity = √(2GM/R) = 11.2 km/s"), show the key steps as numbered lines, and keep units consistent.
- Plain text only (this goes to Telegram): no markdown headers, tables, or asterisks. Use dashes or "1. 2. 3." for lists.

ACCURACY RULES
- Show your working for any calculation so it can be checked. Make sure named concepts match their numbers (e.g. don't label a surface-to-orbit burn as a lunar transfer).
- If you are unsure, separate what you know from what you are not sure of, and say how to verify (textbook, teacher). Never invent facts, quotes, page numbers, or sources.
- If the question is ambiguous, state your one-line assumption and answer anyway instead of asking follow-ups.

STYLE
- No filler ("Great question", "As an AI...") and never repeat the question back.
- Friendly and encouraging.
- Offer a next step only when it clearly helps.`;

export type AskResult = { ok: true; text: string } | { ok: false; reason: string };

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
  error?: { message?: string };
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

type Attempt =
  | { done: true; result: AskResult }
  | { done: false; keyRejected?: boolean };

async function callModel(
  key: string,
  model: string,
  question: string,
  system: string,
): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Athena Telegram Bot",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(config.askTimeoutMs),
    });
  } catch (err) {
    console.error("openrouter fetch failed", err);
    return { done: false };
  }

  let body: ChatCompletionResponse | undefined;
  try {
    body = (await res.json()) as ChatCompletionResponse;
  } catch {
    // non-JSON error body
  }

  if (!res.ok) {
    // Rate limits / upstream flakes are worth retrying on the next free model;
    // key and credit problems are not model-specific, so fail immediately.
    if (res.status === 401 || res.status === 402) return { done: false, keyRejected: true };
    if (res.status === 429 || res.status >= 500) return { done: false };
    return { done: true, result: { ok: false, reason: failureReason(res.status, body?.error?.message) } };
  }

  const raw = body?.choices?.[0]?.message?.content ?? "";
  const text = stripThinking(raw);
  if (isDegenerate(text)) return { done: false };
  return { done: true, result: { ok: true, text } };
}

// ---------------------------------------------------------------------------
// Always-free model chain: primary → fallback → auto-discovered :free models
// ---------------------------------------------------------------------------

interface CatalogEntry {
  id?: string;
  pricing?: { prompt?: string | number; completion?: string | number };
}

const PREFERRED_FAMILIES = ["minimax", "gemma", "glm", "qwen", "llama", "deepseek", "mistral", "nemotron"];

/**
 * Filter a model catalog down to free models only (zero input/output pricing),
 * excluding already-tried ids, preferring well-known families. Pure.
 */
export function pickFreeModels(
  catalog: CatalogEntry[],
  exclude: string[],
  limit = 4,
): string[] {
  const free = catalog
    .filter(
      (m): m is CatalogEntry & { id: string } =>
        typeof m.id === "string" &&
        m.id.length > 0 &&
        (m.id.endsWith(":free") ||
          (Number(m.pricing?.prompt ?? -1) === 0 && Number(m.pricing?.completion ?? -1) === 0)),
    )
    .map((m) => m.id)
    .filter((id) => !exclude.includes(id));
  const score = (id: string) => {
    const i = PREFERRED_FAMILIES.findIndex((f) => id.toLowerCase().includes(f));
    return i === -1 ? PREFERRED_FAMILIES.length : i;
  };
  return free.sort((a, b) => score(a) - score(b)).slice(0, limit);
}

let freeModelCache: { at: number; models: string[] } | undefined;

/** Test hook: clears the discovered free-model cache. */
export function resetFreeModelCache(): void {
  freeModelCache = undefined;
}

async function discoverFreeModels(exclude: string[]): Promise<string[]> {
  if (freeModelCache && Date.now() - freeModelCache.at < 3_600_000) {
    return freeModelCache.models.filter((id) => !exclude.includes(id));
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: CatalogEntry[] };
    const picked = pickFreeModels(data.data ?? [], exclude);
    freeModelCache = { at: Date.now(), models: picked };
    return picked;
  } catch (err) {
    console.error("free-model discovery failed", err);
    return [];
  }
}

export async function askOpenRouter(
  question: string,
  system: string = SYSTEM_PROMPT,
): Promise<AskResult> {
  const keys = config.openrouterKeys;
  const primary = [...new Set([config.openrouterModel, config.openrouterFallback])];
  const extras = await discoverFreeModels(primary);
  const models = [...primary, ...extras].slice(0, 6);

  // Key-major rotation: a rejected (401/402) key skips straight to the next key,
  // a rate-limited key walks the model chain first. Pollinations stays as the
  // deep fallback so one bad key never takes the bot's AI offline.
  let sawKeyError = false;
  for (const key of keys) {
    let nextKey = false;
    for (const model of models) {
      const attempt = await callModel(key, model, question, system);
      if (!attempt.done) {
        if (attempt.keyRejected) {
          sawKeyError = true;
          nextKey = true;
          break;
        }
        continue;
      }
      return attempt.result;
    }
    if (nextKey) continue;
  }

  // Groq (fast Llama) sits between the OpenRouter keys and the keyless
  // Pollinations fallback so a third independent provider guards the chain.
  if (config.groqKey) {
    const g = await askGroq(question, system);
    if (g.ok) return g;
  }

  // Deep fallback: Pollinations' keyless text API — an independent provider,
  // so OpenRouter daily caps or outages don't take the bot's AI offline.
  const backup = await askPollinationsText(question, system);
  if (backup.ok) return backup;

  if (sawKeyError) {
    return {
      ok: false,
      reason: `⚠️ All ${keys.length} configured OpenRouter keys were rejected (401/402). Check OPENROUTER_API_KEY and OPENROUTER_API_KEY_2.._4 in your deployment settings.`,
    };
  }
  return {
    ok: false,
    reason:
      "⚠️ All AI providers (OpenRouter, Groq and the Pollinations backup) are rate-limited or unreachable right now. Please try again in a few minutes.",
  };
}

const POLLINATIONS_TEXT = "https://text.pollinations.ai/openai";

async function askPollinationsText(question: string, system: string): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetch(POLLINATIONS_TEXT, {
      method: "POST",
      headers: { "Content-Type": "application/json", referrer: "athena-bot" },
      body: JSON.stringify({
        model: "openai",
        referrer: "athena-bot",
        messages: [
          { role: "system", content: system },
          { role: "user", content: question },
        ],
      }),
      signal: AbortSignal.timeout(config.askTimeoutMs),
    });
  } catch (err) {
    console.error("pollinations text failed", err);
    return { ok: false, reason: "unreachable" };
  }
  if (!res.ok) {
    console.error("pollinations text status", res.status);
    return { ok: false, reason: `status ${res.status}` };
  }
  const data = (await res.json().catch(() => undefined)) as
    | { choices?: { message?: { content?: string | null } }[] }
    | undefined;
  const text = stripThinking(data?.choices?.[0]?.message?.content ?? "");
  if (text.length === 0 || isDegenerate(text)) return { ok: false, reason: "empty" };
  return { ok: true, text };
}
