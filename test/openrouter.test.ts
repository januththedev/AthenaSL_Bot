import { afterEach, describe, expect, it, vi } from "vitest";
import { askOpenRouter, chunkText, stripThinking } from "../src/openrouter.js";

process.env["OPENROUTER_API_KEY"] = "test-key";
process.env["OPENROUTER_MODEL"] = "test/model:free";

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

  it("surfaces empty completions as failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 }),
      ),
    );
    const res = await askOpenRouter("q");
    expect(res.ok).toBe(false);
  });
});
