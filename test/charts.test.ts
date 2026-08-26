import { describe, expect, it } from "vitest";
import {
  extractChartMarker,
  formatNumber,
  parseChartSpec,
  renderChartSvg,
} from "../src/modules/charts.js";

const good = JSON.stringify({
  type: "bar",
  title: "Distance from Earth",
  unit: "km",
  items: [
    { label: "Moon", value: 384400 },
    { label: "Voyager 1", value: 25000000000 },
  ],
});

describe("parseChartSpec", () => {
  it("parses a valid spec", () => {
    const s = parseChartSpec(good);
    expect(s?.type).toBe("bar");
    expect(s?.items[0]).toEqual({ label: "Moon", value: 384400 });
    expect(s?.unit).toBe("km");
  });

  it("parses fenced JSON with prose around it", () => {
    expect(parseChartSpec(`Spec:\n\`\`\`json\n${good}\n\`\`\``)?.title).toBe("Distance from Earth");
  });

  it("rejects malformed specs", () => {
    expect(parseChartSpec("nothing")).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "scatter", title: "x", items: [{ label: "a", value: 1 }, { label: "b", value: 2 }] }))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "bar", title: "x", items: [{ label: "a", value: -5 }, { label: "b", value: 2 }] }))).toBeNull();
    expect(parseChartSpec(JSON.stringify({ type: "bar", title: "x", items: [{ label: "a", value: Number.NaN }, { label: "b", value: 2 }] }))).toBeNull();
  });
});

describe("extractChartMarker", () => {
  it("splits answer from trailing CHART marker", () => {
    const { answer, spec } = extractChartMarker(
      `The Moon is 384,400 km away.\nCHART:{"type":"bar","title":"D","items":[{"label":"a","value":1},{"label":"b","value":2}]}`,
    );
    expect(answer).toBe("The Moon is 384,400 km away.");
    expect(spec?.type).toBe("bar");
  });

  it("passes plain answers through untouched", () => {
    const { answer, spec } = extractChartMarker("Just text, no chart.");
    expect(answer).toBe("Just text, no chart.");
    expect(spec).toBeNull();
  });

  it("ignores invalid markers (answer still delivered)", () => {
    const { answer, spec } = extractChartMarker("Answer.\nCHART:{broken json");
    expect(answer).toBe("Answer.");
    expect(spec).toBeNull();
  });
});

describe("formatNumber", () => {
  it("formats magnitudes", () => {
    expect(formatNumber(384400)).toBe("384,400");
    expect(formatNumber(25_000_000_000)).toBe("25B");
    expect(formatNumber(3_400_000)).toBe("3.4M");
    expect(formatNumber(42)).toBe("42");
  });
});

describe("renderChartSvg", () => {
  const spec = parseChartSpec(good)!;

  it("draws every label and true value", () => {
    const svg = renderChartSvg(spec);
    expect(svg).toContain("Distance from Earth");
    expect(svg).toContain("Moon");
    expect(svg).toContain("Voyager 1");
    expect(svg).toContain("384,400 km");
    expect(svg).toContain("25B km");
  });

  it("notes sqrt scaling when magnitudes diverge hugely", () => {
    const svg = renderChartSvg(spec);
    expect(svg).toContain("√ scale");
  });

  it("renders pie legends with percentages", () => {
    const pie = parseChartSpec(
      JSON.stringify({ type: "pie", title: "Split", items: [{ label: "A", value: 75 }, { label: "B", value: 25 }] }),
    )!;
    const svg = renderChartSvg(pie);
    expect(svg).toContain("A — 75 (75%)");
    expect(svg).toContain("<path");
  });
});
