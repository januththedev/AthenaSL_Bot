import { afterEach, describe, expect, it, vi } from "vitest";
import { askGroq } from "../src/modules/groq.js";

describe("askGroq", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["GROQ_API_KEY"];
  });

  it("reports not-configured without a key", async () => {
    delete process.env["GROQ_API_KEY"];
    const res = await askGroq("q", "sys");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("not configured");
  });

  it("answers via the Groq API when configured", async () => {
    process.env["GROQ_API_KEY"] = "gsk_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "Groq says hi." } }] }), { status: 200 }),
      ),
    );
    const res = await askGroq("q", "sys");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("Groq says hi.");
  });

  it("surfaces rate limits as failures so the chain continues", async () => {
    process.env["GROQ_API_KEY"] = "gsk_test";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: {} }), { status: 429 })),
    );
    const res = await askGroq("q", "sys");
    expect(res.ok).toBe(false);
  });
});
