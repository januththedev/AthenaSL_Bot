import { describe, expect, it } from "vitest";
import { routeDecision, ROUTE_INSTRUCTION, PYTHON_GROUNDING } from "../src/modules/router.js";

describe("routeDecision", () => {
  it("routes computation questions to python", () => {
    expect(routeDecision("calculate the compound interest on 5000")).toBe("python");
    expect(routeDecision("what is the derivative of x^2")).toBe("python");
    expect(routeDecision("convert 5 km to miles")).toBe("python");
  });

  it("routes misspelled and physics computation questions to python", () => {
    // Real user typo that previously fell through to the generic chain:
    expect(routeDecision("calculte the velocity need to reach moon for a rocket")).toBe("python");
    expect(routeDecision("cal the time needed")).toBe("python");
    expect(routeDecision("time needed to reach the moon")).toBe("python");
    expect(routeDecision("how much fuel is required for a 10 ton rocket")).toBe("python");
    expect(routeDecision("what is escape velocity")).toBe("python");
  });

  it("routes current-events questions to web", () => {
    expect(routeDecision("who won the cricket match today?")).toBe("web");
    expect(routeDecision("latest news about space launches")).toBe("web");
    expect(routeDecision("weather in Colombo this week")).toBe("web");
  });

  it("keeps knowledge questions on the normal chain", () => {
    expect(routeDecision("explain photosynthesis")).toBe("auto");
    expect(routeDecision("what is the capital of France in the 19th century")).toBe("auto");
  });

  it("python takes priority when both match", () => {
    expect(routeDecision("calculate the average rainfall today")).toBe("python");
  });

  it("exposes the ROUTE instruction for the system prompt", () => {
    expect(ROUTE_INSTRUCTION).toContain("ROUTE:web");
    expect(ROUTE_INSTRUCTION).toContain("ROUTE:python");
  });

  it("grounds python-routed answers in real physics", () => {
    expect(PYTHON_GROUNDING).toContain("3.986×10¹⁴");
    expect(PYTHON_GROUNDING).toContain("Hohmann");
    expect(PYTHON_GROUNDING).toContain("rocket equation");
    expect(PYTHON_GROUNDING).toContain("never use LaTeX");
    expect(PYTHON_GROUNDING).toContain("NEVER assume constant acceleration");
  });
});
