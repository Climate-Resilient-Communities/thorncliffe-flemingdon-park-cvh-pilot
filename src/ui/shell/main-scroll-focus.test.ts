import { describe, expect, it } from "vitest";
import { needsScrollStop } from "./main-scroll-focus";

describe("needsScrollStop (production UAT, 2026-10-08: an Urdu building page's main scrolled with nothing a keyboard could reach)", () => {
  it("is a tab stop only for a main that scrolls with nothing focusable inside it", () => {
    expect(needsScrollStop(true, false)).toBe(true);
    expect(needsScrollStop(true, true)).toBe(false);
    expect(needsScrollStop(false, false)).toBe(false);
    expect(needsScrollStop(false, true)).toBe(false);
  });
});
