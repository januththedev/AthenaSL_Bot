import { describe, expect, it } from "vitest";
import { parseWhen } from "../src/modules/reminders.js";
import { parseQuiz } from "../src/modules/quiz.js";
import { personaSystemSuffix } from "../src/modules/persona.js";
import { mergeSettings } from "../src/store.js";

// Fixed reference time: 2026-08-26T10:00:00 local
const NOW = new Date(2026, 7, 26, 10, 0, 0, 0);

describe("parseWhen", () => {
  it("parses combined relative durations", () => {
    const p = parseWhen("1h30m", NOW);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.at - NOW.getTime()).toBe(90 * 60_000);
  });

  it("rolls HH:MM to tomorrow when already past", () => {
    const past = parseWhen("09:00", NOW);
    const future = parseWhen("18:30", NOW);
    expect(past.ok && future.ok).toBe(true);
    if (past.ok && future.ok) {
      expect(past.at - NOW.getTime()).toBe(23 * 3600_000);
      expect(future.at - NOW.getTime()).toBe(8.5 * 3600_000);
    }
  });

  it("parses calendar dates at 09:00 by default", () => {
    const p = parseWhen("2026-09-01", NOW);
    expect(p.ok).toBe(true);
    if (p.ok) expect(new Date(p.at).getDate()).toBe(1);
  });

  it("rejects too-short and garbage input", () => {
    expect(parseWhen("5s", NOW).ok).toBe(false);
    expect(parseWhen("banana", NOW).ok).toBe(false);
    expect(parseWhen("", NOW).ok).toBe(false);
  });
});

describe("parseQuiz", () => {
  const good = JSON.stringify([
    { question: "2+2?", options: ["3", "4", "5", "6"], answer: 1 },
    { question: "H2O is?", options: ["water", "salt", "gold", "air"], answer: 0 },
    { question: "Sun is a?", options: ["planet", "star", "moon", "comet"], answer: 1 },
  ]);

  it("accepts a valid bare JSON array", () => {
    expect(parseQuiz(good)?.length).toBe(3);
  });

  it("accepts a fenced JSON block with prose around it", () => {
    expect(parseQuiz(`Here you go:\n\`\`\`json\n${good}\n\`\`\`\nEnjoy!`)?.length).toBe(3);
  });

  it("rejects malformed shapes", () => {
    expect(parseQuiz("not json")).toBeNull();
    expect(parseQuiz(JSON.stringify([{ question: "x", options: ["a"], answer: 0 }]))).toBeNull();
    expect(parseQuiz(JSON.stringify([{ question: "x", options: ["a", "b", "c", "d"], answer: 9 }]))).toBeNull();
  });
});

describe("persona", () => {
  it("appends group instructions only when set", () => {
    expect(personaSystemSuffix(null)).toBe("");
    expect(personaSystemSuffix("  ")).toBe("");
    const s = personaSystemSuffix("Answer in Sinhala first.");
    expect(s).toContain("GROUP CUSTOM STYLE");
    expect(s).toContain("Sinhala");
  });

  it("survives the settings merge", () => {
    expect(mergeSettings({ persona: "Be brief" }).persona).toBe("Be brief");
    expect(mergeSettings({}).persona).toBeNull();
  });
});
