import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askOpenRouter, chunkText, isDegenerate, pickFreeModels, resetFreeModelCache, stripThinking } from "../src/openrouter.js";

process.env["OPENROUTER_API_KEY"] = "test-key";
process.env["OPENROUTER_MODEL"] = "test/model:free";
delete process.env["OPENROUTER_MODEL_FALLBACK"];

describe("stripThinking", () => {
  it("removes complete think blocks", () => {
    expect(stripThinking("<think>hmm let me reason</think>The answer is 4.")).toBe(
      "The answer is 4.",
    );
  });

  it("drops everything after an unterminated think tag", () => {
    expect(stripThinking("Answer first<think>cut off mid-thought")).toBe("Answer first");
  });

  it("leaves normal text alone", () => {
    expect(stripThinking("just text")).toBe("just text");
  });
});

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    expect(chunkText("hello", 100)).toEqual(["hello"]);
  });

  it("splits long text preferring line breaks", () => {
    const half = "a".repeat(60);
    const text = `${half}\n${"b".repeat(60)}`;
    const parts = chunkText(text, 80);
    expect(parts.length).toBe(2);
    expect(parts[0]).toBe(half);
  });
});

describe("isDegenerate", () => {
  it("flags empty output and leaked reasoning/safety fragments", () => {
    expect(isDegenerate("")).toBe(true);
    expect(isDegenerate("User Safety: safe")).toBe(true);
    expect(isDegenerate("We need to answer: the moon is 384,400 km away")).toBe(true);
    expect(isDegenerate("Okay, so the moon is about 384,400 km away")).toBe(true);
  });

  it("accepts normal direct answers", () => {
    expect(isDegenerate("The Moon is about 384,400 km away on average.")).toBe(false);
    expect(isDegenerate("42")).toBe(false);
  });
});

describe("pickFreeModels", () => {
  const catalog = [
    { id: "openai/gpt-4o", pricing: { prompt: "2.5", completion: "10" } },
    { id: "minimax/minimax-m2.7:free" },
    { id: "z-ai/glm-5.2:free" },
    { id: "google/gemma-4-31b-it:free" },
    { id: "tiny/unknown:free" },
    { id: "paid-but-zero-typo", pricing: { prompt: "0.0001", completion: "3" } },
  ];

  it("keeps only free models and excludes already-tried ones", () => {
    const picked = pickFreeModels(catalog, ["minimax/minimax-m2.7:free", "google/gemma-4-31b-it:free"]);
    expect(picked).toEqual(["z-ai/glm-5.2:free", "tiny/unknown:free"]);
  });

  it("prefers well-known families over unknown ones", () => {
    const picked = pickFreeModels(catalog, []);
    expect(picked[0]).toBe("minimax/minimax-m2.7:free");
    expect(picked).not.toContain("openai/gpt-4o");
    expect(picked).not.toContain("paid-but-zero-typo");
  });

  it("respects the limit", () => {
    expect(pickFreeModels(catalog, [], 1).length).toBe(1);
  });
});

describe("askOpenRouter", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => resetFreeModelCache());

  it("walks the discovered free-model chain on rate limits", async () => {
    const tried: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: unknown) => {
        const u = String(url);
        if (u.includes("/models")) {
          return new Response(JSON.stringify({ data: [{ id: "z-ai/glm-5.2:free" }] }), { status: 200 });
        }
        const body = JSON.parse(String((init as RequestInit).body)) as { model: string };
        tried.push(body.model);
        if (body.model === "z-ai/glm-5.2:free") {
          return new Response(JSON.stringify({ choices: [{ message: { content: "Answer from glm." } }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 });
      }),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("Answer from glm.");
    expect(tried).toContain("z-ai/glm-5.2:free");
  });

  it("falls back to the keyless Pollinations text API when OpenRouter is limited", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        if (u.includes("openrouter.ai")) return new Response(JSON.stringify({ error: { message: "daily cap" } }), { status: 429 });
        if (u.includes("text.pollinations.ai")) {
          return new Response(JSON.stringify({ choices: [{ message: { content: "Backup answer." } }] }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      }),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("Backup answer.");
  });

  it("rotates to the next API key when one is rate-limited", async () => {
    process.env["OPENROUTER_API_KEYS"] = "sk-key-a,sk-key-b";
    resetFreeModelCache();
    const tried: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown, init?: unknown) => {
        const u = String(url);
        if (u.includes("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        const auth = String((init as RequestInit).headers && (init as RequestInit).headers instanceof Object ? JSON.stringify((init as RequestInit).headers) : "");
        const body = JSON.parse(String((init as RequestInit).body)) as { model: string };
        const key = auth.includes("sk-key-a") ? "a" : "b";
        tried.push(`${key}:${body.model}`);
        if (key === "a") return new Response(JSON.stringify({ error: { message: "cap" } }), { status: 429 });
        return new Response(JSON.stringify({ choices: [{ message: { content: "Key B answer." } }] }), { status: 200 });
      }),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("Key B answer.");
    expect(tried.some((t) => t.startsWith("b:"))).toBe(true);
    delete process.env["OPENROUTER_API_KEYS"];
  });

  it("explains when both providers fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/models")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
        return new Response(JSON.stringify({ error: { message: "limited" } }), { status: 429 });
      }),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Both AI providers");
  });

  it("maps a 401 to a friendly key error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 })),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("API key");
  });

  it("returns cleaned model output on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "<think>reasoning</think>Final answer." } }],
          }),
          { status: 200 },
        ),
      ),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("Final answer.");
  });

  it("retries the fallback model when the primary returns junk", async () => {
    const junk = new Response(
      JSON.stringify({ choices: [{ message: { content: "User Safety: safe" } }] }),
      { status: 200 },
    );
    const good = new Response(
      JSON.stringify({ choices: [{ message: { content: "The Moon is 384,400 km away." } }] }),
      { status: 200 },
    );
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { model: string };
        calls.push(body.model);
        return calls.length === 1 ? junk : good;
      }),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toContain("384,400");
    expect(calls.length).toBe(2);
  });

  it("fails with a clear reason when every model returns junk", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
      ),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("Both AI providers");
  });
});
