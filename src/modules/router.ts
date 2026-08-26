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
  /\b(calc\w*|comput\w*|solve|evaluate|derivative|differentiat\w*|integrat\w*|limit of|probability|per ?cent of|percentage|square root|cube root|factorial|prime|fibonacci|matrix|determinant|convert .+ (to|into)|how (fast|long|much (fuel|thrust|energy|force|power))\b|(time|fuel|thrust|energy|velocity|speed) (needed|required|to reach)|sum of|average of|mean of|standard deviation|compound interest|simple interest|emi|gpa|escape velocity|delta.?v|trajectory)\b/i;

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

/**
 * Injected when a question is routed to python execution: real constants,
 * real mission benchmarks and hard bans on the classic failure modes
 * (fake constant-acceleration space travel, LaTeX in Telegram).
 */
export const PYTHON_GROUNDING =

  "\n\nCOMPUTATION GROUNDING (follow exactly):\n" +
  "- MATH FORMAT: never use LaTeX (no \\frac, \\sqrt, ^{}). Write plain text: v = √(μ/r) = 1.02 km/s, x², 3.84×10⁸ m.\n" +
  "- Write python that computes step by step and print every intermediate value, so the student can follow.\n" +
  "- REAL CONSTANTS: Earth μ = GM = 3.986×10¹⁴ m³/s²; Moon μ = 4.904×10¹² m³/s²; Earth radius 6,371 km; Earth-Moon distance 384,400 km; g₀ = 9.81 m/s².\n" +
  "- REAL SPACE BENCHMARKS: surface→low Earth orbit ≈ 9.4 km/s (incl. losses); LEO orbital speed 7.8 km/s; trans-lunar injection from LEO ≈ 3.2 km/s; escape velocity from surface 11.2 km/s; Apollo reached the Moon in ~3 days; a pure Hohmann transfer takes ~5 days, t = π·√(a³/μ) with a = (r₁+r₂)/2.\n" +
  "- Rocket mass changes FUEL via the rocket equation (Δv = Isp·g₀·ln(m₀/m₁), chemical Isp ≈ 300-450 s), never the Δv required.\n" +
  "- NEVER assume constant acceleration across space — use orbital mechanics, or say clearly it is only a rough toy model and give the real mission comparison too.\n" +
  "- Prefer real mission data (Apollo, Artemis, Falcon 9) as sanity checks on your numbers.";
