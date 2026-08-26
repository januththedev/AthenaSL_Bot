import { afterEach, describe, expect, it, vi } from "vitest";
import { askOpenRouter, chunkText, isDegenerate, stripThinking } from "../src/openrouter.js";

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

describe("askOpenRouter", () => {
  afterEach(() => vi.unstubAllGlobals());

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
    if (!res.ok) expect(res.reason).toContain("unusable");
  });
});
