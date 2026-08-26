import { config } from "./config.js";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export const SYSTEM_PROMPT = `You are Athena, the study-group assistant inside a Telegram chat.
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

/**
 * Detects unusable model output: empty text, safety-check fragments, or
 * leaked chain-of-thought openers (seen on free reasoning models). Pure.
 */
export function isDegenerate(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  return /^(user safety\s*:|safety\s*:|we need to\b|okay,\s|let me\b|let's\b|first,)/i.test(t);
}

type Attempt = { done: true; result: AskResult } | { done: false };

async function callModel(
  model: string,
  question: string,
  system: string,
): Promise<Attempt> {
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
  const primary = [...new Set([config.openrouterModel, config.openrouterFallback])];
  const extras = await discoverFreeModels(primary);
  const models = [...primary, ...extras].slice(0, 6);

  for (const model of models) {
    const attempt = await callModel(model, question, system);
    if (attempt.done) return attempt.result;
  }

  // Deep fallback: Pollinations' keyless text API — an independent provider,
  // so OpenRouter daily caps or outages don't take the bot's AI offline.
  const backup = await askPollinationsText(question, system);
  if (backup.ok) return backup;

  return {
    ok: false,
    reason:
      "⚠️ Both AI providers (OpenRouter free models and the Pollinations backup) are rate-limited or unreachable right now. Please try again in a few minutes.",
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
