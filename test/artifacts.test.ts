import { describe, expect, it } from "vitest";
import { parseArtifact, safeFilename } from "../src/modules/artifacts.js";
import { drawImageUrl } from "../src/modules/images.js";

describe("safeFilename", () => {
  it("accepts valid filenames with the right extension", () => {
    expect(safeFilename("prime-checker.py", "code")).toBe("prime-checker.py");
    expect(safeFilename("pie-chart.svg", "svg")).toBe("pie-chart.svg");
    expect(safeFilename("study-notes.md", "doc")).toBe("study-notes.md");
  });

  it("strips illegal characters and paths", () => {
    expect(safeFilename("../../etc/passwd.py", "code")).toBe("etcpasswd.py");
    expect(safeFilename("My File!.py", "code")).toBe("myfile.py");
  });

  it("fixes or replaces wrong extensions", () => {
    expect(safeFilename("chart.png", "svg")).toBe("chart.svg");
    expect(safeFilename("no-extension", "code")).toBe("no-extension.py");
    expect(safeFilename("", "doc")).toBe("notes.md");
  });
});

describe("parseArtifact", () => {
  const good = JSON.stringify({
    type: "code",
    filename: "prime.py",
    content: "def is_prime(n):\n    return n > 1 and all(n % i for i in range(2, n))",
  });

  it("parses a bare JSON object", () => {
    const a = parseArtifact(good);
    expect(a?.type).toBe("code");
    expect(a?.filename).toBe("prime.py");
  });

  it("parses JSON inside prose or fences", () => {
    expect(parseArtifact(`Here you go:\n\`\`\`json\n${good}\n\`\`\``)?.filename).toBe("prime.py");
  });

  it("rejects malformed output", () => {
    expect(parseArtifact("no json here")).toBeNull();
    expect(parseArtifact(JSON.stringify({ type: "movie", filename: "x.txt", content: "abc def ghi jkl" }))).toBeNull();
    expect(parseArtifact(JSON.stringify({ type: "code", filename: "a.py", content: "short" }))).toBeNull();
  });
});

describe("drawImageUrl", () => {
  it("encodes the prompt and includes parameters", () => {
    const url = drawImageUrl("water cycle, blue tones", 42, "flux");
    expect(url.startsWith("https://image.pollinations.ai/prompt/")).toBe(true);
    expect(url).toContain("water%20cycle");
    expect(url).toContain("seed=42");
    expect(url).toContain("model=flux");
    expect(url).toContain("nologo=true");
  });
});
