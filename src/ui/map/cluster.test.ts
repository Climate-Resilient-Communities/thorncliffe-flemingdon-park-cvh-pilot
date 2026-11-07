import { describe, expect, it } from "vitest";
import { clusterWidth } from "./leaflet-map";

describe("a cluster's pill", () => {
  it("is as wide as its words, never narrower than a tap target is tall", () => {
    expect(clusterWidth("2 places")).toBeGreaterThan(clusterWidth("2"));
    expect(clusterWidth("2")).toBe(44);
    expect(clusterWidth("12 places")).toBeGreaterThanOrEqual(90);
  });

  it("counts a wide character as about twice a narrow one", () => {
    expect(clusterWidth("3 个地点")).toBeGreaterThan(clusterWidth("3 abc"));
  });
});
