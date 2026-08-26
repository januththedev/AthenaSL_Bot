import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { LocalBackend } from "../src/store.js";

const file = join(tmpdir(), `athena-test-${Date.now()}.json`);

describe("LocalBackend", () => {
  it("persists values across instances and handles del/incr/expire/keys", async () => {
    const a = new LocalBackend(file);
    await a.set("chat:1:cfg", { rules: "be kind" });
    expect(await a.get("chat:1:cfg")).toEqual({ rules: "be kind" });

    // incr + expire semantics
    expect(await a.incr("ask:1:2:2026-08-25")).toBe(1);
    expect(await a.incr("ask:1:2:2026-08-25")).toBe(2);
    expect(await a.expire("missing-key", 10)).toBe(0);
    expect(await a.expire("ask:1:2:2026-08-25", 10)).toBe(1);

    // glob keys
    await a.set("chat:1:note:physics", "F=ma");
    expect(await a.keys("chat:1:note:*")).toEqual(["chat:1:note:physics"]);
    expect(await a.keys("chat:9:note:*")).toEqual([]);

    // persistence across instances
    const b = new LocalBackend(file);
    expect(await b.get("chat:1:note:physics")).toBe("F=ma");
    expect(await b.incr("ask:1:2:2026-08-25")).toBe(3);

    // deletion
    expect(await b.del("chat:1:cfg")).toBe(1);
    expect(await b.get("chat:1:cfg")).toBeNull();

    rmSync(file, { force: true });
  });

  it("treats expired entries as missing", async () => {
    const file2 = join(tmpdir(), `athena-test-exp-${Date.now()}.json`);
    const c = new LocalBackend(file2);
    await c.set("temp", "x");
    await c.expire("temp", -1); // already expired
    expect(await c.get("temp")).toBeNull();
    expect(await c.keys("temp")).toEqual([]);
    rmSync(file2, { force: true });
  });
});
