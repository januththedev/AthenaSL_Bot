import { describe, expect, it } from "vitest";
import { mergeSettings, quotaDay, DEFAULT_SETTINGS } from "../src/store.js";
import { extractNoteTags } from "../src/modules/notes.js";
import { findFilterReply } from "../src/modules/filters.js";

describe("mergeSettings", () => {
  it("returns defaults for empty/invalid storage", () => {
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings("garbage")).toEqual(DEFAULT_SETTINGS);
  });

  it("overlays only provided fields", () => {
    const merged = mergeSettings({ rules: "Be nice", warnLimit: 5 });
    expect(merged.rules).toBe("Be nice");
    expect(merged.warnLimit).toBe(5);
    expect(merged.locks).toEqual([]);
    expect(merged.welcome.enabled).toBe(true);
  });

  it("rejects invalid enum/number values", () => {
    const merged = mergeSettings({ warnAction: "nuke", warnLimit: -3, antiflood: { limit: 0 } });
    expect(merged.warnAction).toBe(DEFAULT_SETTINGS.warnAction);
    expect(merged.warnLimit).toBe(DEFAULT_SETTINGS.warnLimit);
    expect(merged.antiflood.limit).toBe(DEFAULT_SETTINGS.antiflood.limit);
  });
});

describe("quotaDay", () => {
  it("produces a UTC yyyy-mm-dd bucket", () => {
    expect(quotaDay(new Date("2026-08-25T13:45:00Z"))).toBe("2026-08-25");
  });
});

describe("extractNoteTags", () => {
  it("extracts unique lowercase tags", () => {
    expect(extractNoteTags("see #Physics and #physics plus #chem_101!")).toEqual([
      "physics",
      "chem_101",
    ]);
  });

  it("ignores single-character tags", () => {
    expect(extractNoteTags("#a #bb")).toEqual(["bb"]);
  });
});

describe("findFilterReply", () => {
  const entries = [
    { keyword: "homework", reply: "Do your homework!" },
    { keyword: "exam", reply: "Good luck 🍀" },
  ];

  it("matches case-insensitively on substring", () => {
    expect(findFilterReply(entries, "When is the EXAM?")).toBe("Good luck 🍀");
    expect(findFilterReply(entries, "no match here")).toBeNull();
  });
});
