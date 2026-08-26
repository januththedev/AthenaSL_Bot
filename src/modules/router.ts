/**
 * Automatic routing for /ask: every user prompt is examined once (free,
 * heuristic — no extra AI call) and sent to the provider that can actually
 * serve it. Questions needing fresh web facts or exact computation go to
 * Groq's compound model (built-in web search + python execution); everything
 * else flows through the free OpenRouter chain.
 */

export type Route = "web" | "python" | "auto";

const WEB_HINTS =
  /\b(today|tonight|yesterday|current(ly)?|latest|newest|recent(ly)?|right now|this (week|month|year)|last (week|month|year)|news|headlines?|weather|forecast|temperature( in)?|price of|stock|shares?|exchange rate|who won|standings|fixture|release date|upcoming|announced|launched|2025|2026|population of)\b/i;

const PYTHON_HINTS =
  /\b(calculate|compute|solve|evaluate|derivative|differentiate|integrate|integral|limit of|probability|per ?cent of|percentage|square root|cube root|factorial|prime|fibonacci|matrix|determinant|convert .+ (to|into)|how many (seconds|minutes|hours|days|weeks)|sum of|average of|mean of|standard deviation|compound interest|simple interest|emi|gpa)\b/i;

/** Pure heuristic routing decision. */
export function routeDecision(question: string): Route {
  if (PYTHON_HINTS.test(question)) return "python";
  if (WEB_HINTS.test(question)) return "web";
  return "auto";
}

/** Appended to the /ask system prompt so the model can request a reroute. */
export const ROUTE_INSTRUCTION =

  "\n\nTOOL ROUTING: If answering accurately genuinely REQUIRES fresh web information or exact computation you cannot do reliably from your knowledge, reply with ONLY one line and nothing else:\n" +
  "ROUTE:web   (needs current/fresh web facts)\n" +
  "ROUTE:python   (needs exact computation)\n" +
  "Otherwise answer normally — never use ROUTE when you already know the answer.";
