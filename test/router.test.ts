import { describe, expect, it } from "vitest";
import { routeDecision, ROUTE_INSTRUCTION } from "../src/modules/router.js";

describe("routeDecision", () => {
  it("routes computation questions to python", () => {
    expect(routeDecision("calculate the compound interest on 5000")).toBe("python");
    expect(routeDecision("what is the derivative of x^2")).toBe("python");
    expect(routeDecision("convert 5 km to miles")).toBe("python");
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
});
