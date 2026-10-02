import { describe, expect, it } from "vitest";
import { gatePhase } from "./gate-phase";

describe("gatePhase", () => {
  it("waits until the phone has been read and probed", () => {
    expect(gatePhase(undefined, true)).toBe("pending");
    expect(gatePhase({ v: 1, welcomed: true }, undefined)).toBe("pending");
    expect(gatePhase(undefined, undefined)).toBe("pending");
  });

  it("sends a first visit to R-01: nothing saved, or the steps not gone through", () => {
    expect(gatePhase(null, true)).toBe("redirecting");
    expect(gatePhase({ v: 1, lang: "ur" }, true)).toBe("redirecting");
  });

  it("shows home once the steps have been gone through", () => {
    expect(gatePhase({ v: 1, welcomed: true }, true)).toBe("ready");
  });

  it("shows home, and does not redirect, when the phone keeps nothing: every visit would be a first one", () => {
    expect(gatePhase(null, false)).toBe("ready");
    expect(gatePhase({ v: 1, lang: "ur" }, false)).toBe("ready");
  });
});
