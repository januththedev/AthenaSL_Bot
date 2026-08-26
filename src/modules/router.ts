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

/** Tolerant marker matcher: "ROUTE: python", "route:web.", extra spaces all match. */
export const ROUTE_MARKER = /^\s*ROUTE:\s*(web|python)\b[.\s]*$/im;

/** Appended to the /ask system prompt so the model can request a reroute. */
export const ROUTE_INSTRUCTION =

  "\n\nTOOL ROUTING: If answering accurately genuinely REQUIRES fresh web information or exact computation you cannot do reliably from your knowledge, reply with ONLY one line and nothing else:\n" +
  "ROUTE:web   (needs current/fresh web facts)\n" +
  "ROUTE:python   (needs exact computation)\n" +
  "Otherwise answer normally — never use ROUTE when you already know the answer.";

// ---------------------------------------------------------------------------
// Language detection: Sinhala/Tamil in native script OR romanized (Singlish/
// Tanglish), which is extremely common in Sri Lanka.
// ---------------------------------------------------------------------------

const SINHALA_SCRIPT = /[\u0D80-\u0DFF]/;
const TAMIL_SCRIPT = /[\u0B80-\u0BFF]/;

const SINHALA_ROMANIZED =
  /\b(mama|mata|mage|muge|oya|oyage|oyata|api|apita|ape|kohomada|kohomane|mokakda|mokada|monawada|kochchara|kochchar|kiyanna|kiyala|dananna|dananne|karanna|karala|ganna|gaththa|wenna|enna|ennako|balanna|balan|pruthuwiya|pruthuvi|lankawe|lanka|sinhala|sinhale|gedara|iskole|iskolaya|passe|hitapu|durak|dura|yanna|yanawa|thiyenawa|thiyenne|wenne)\b/i;

const TAMIL_ROMANIZED =
  /\b(enna|eppadi|epadi|irukku|iruku|venum|vennum|panra|pannen|solu|sollu|solringa|thambi|akka|anna|vanakkam|nanri|romba|nalla|padikka|eppadi irukku)\b/i;

export type InputLang = "si" | "ta" | "en";

function countMatches(source: string, text: string): number {
  return (text.toLowerCase().match(new RegExp(source, "gi")) ?? []).length;
}

/** Detect Sinhala/Tamil in native script or romanized form. Pure. */
export function detectLanguage(question: string): InputLang {
  if (SINHALA_SCRIPT.test(question)) return "si";
  if (TAMIL_SCRIPT.test(question)) return "ta";
  // Romanized: score both word lists — several words overlap between
  // Singlish and Tanglish ("enna", "anna"), so the higher count wins.
  const si = countMatches(SINHALA_ROMANIZED.source, question);
  const ta = countMatches(TAMIL_ROMANIZED.source, question);
  if (si === 0 && ta === 0) return "en";
  return ta > si ? "ta" : "si";
}

/** Extra system instructions for non-English input; undefined for English. */
export function languageAddendum(lang: InputLang): string | undefined {
  if (lang === "si") {
    return (
      "\n\nINPUT LANGUAGE: The question is Sinhala, possibly typed in English letters (Singlish). " +
      "Silently translate it to English first, work out the correct answer, then reply in clear, grammatical Sinhala script. " +
      "If you are not certain of a Sinhala word, keep the English term in brackets. Never write broken or nonsensical Sinhala — " +
      "if you cannot produce correct Sinhala, reply in simple English and say so."
    );
  }
  if (lang === "ta") {
    return (
      "\n\nINPUT LANGUAGE: The question is Tamil, possibly typed in English letters (Tanglish). " +
      "Silently translate it to English first, work out the correct answer, then reply in clear, grammatical Tamil script. " +
      "Never write broken Tamil — if you cannot produce correct Tamil, reply in simple English and say so."
    );
  }
  return undefined;
}

/**
 * Injected when a question is routed to python execution: real constants,
 * real mission benchmarks and hard bans on the classic failure modes
 * (fake constant-acceleration space travel, LaTeX in Telegram).
 */
export const PYTHON_GROUNDING =

  "\n\nCOMPUTATION GROUNDING (follow exactly):\n" +
  "- MATH FORMAT: never use LaTeX (no \\frac, \\sqrt, ^{}) and never markdown tables — write plain text: v = √(μ/r) = 1.02 km/s, x², 3.84×10⁸ m. Use dashes for lists.\n" +
  "- COPY NUMBERS EXACTLY: after running python, copy the printed results into your answer VERBATIM. Never re-do big-exponent arithmetic by hand (anything with 10⁶ and above) — that is where errors happen. If your printed result says 430,000 s ≈ 5.0 days, write exactly that.\n" +
  "- Write python that computes step by step and print every intermediate value, so the student can follow.\n" +
  "- Use SI units (meters, seconds) inside orbital formulas, and ONE consistent unit in the final answer (travel times in days).\n" +
  "- REAL CONSTANTS: Earth μ = GM = 3.986×10¹⁴ m³/s²; Moon μ = 4.904×10¹² m³/s²; Earth radius 6,371 km; Earth-Moon distance 384,400 km; g₀ = 9.81 m/s².\n" +
  "- REAL SPACE BENCHMARKS: surface→low Earth orbit ≈ 9.4 km/s (incl. losses); LEO orbital speed 7.8 km/s; trans-lunar injection from LEO ≈ 3.2 km/s; escape velocity from surface 11.2 km/s; Apollo reached the Moon in ~3 days; a pure Hohmann transfer takes ~5 days, t = π·√(a³/μ) with a = (r₁+r₂)/2.\n" +
  "- Rocket mass changes FUEL via the rocket equation (Δv = Isp·g₀·ln(m₀/m₁), chemical Isp ≈ 300-450 s), never the Δv required.\n" +
  "- NEVER assume constant acceleration across space — use orbital mechanics, or say clearly it is only a rough toy model and give the real mission comparison too.\n" +
  "- Prefer real mission data (Apollo, Artemis, Falcon 9) as sanity checks on your numbers.\n" +
  "- CHART RULES: use ONE consistent unit for every item in the chart; convert first, then plot. Chart titles and labels must be English or native Sinhala/Tamil script — NEVER romanized transliteration.";
