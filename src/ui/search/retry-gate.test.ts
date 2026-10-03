import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRetryGate } from "./retry-gate";

describe("createRetryGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("is open until the server says to wait", () => {
    expect(createRetryGate().closed()).toBe(false);
  });

  it("holds a submit until Retry-After has passed, then lets it through", () => {
    const gate = createRetryGate();
    gate.waitFor(30);
    expect(gate.closed()).toBe(true);
    vi.advanceTimersByTime(29_999);
    expect(gate.closed()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(gate.closed()).toBe(false);
  });

  it("a later Retry-After replaces the earlier one", () => {
    const gate = createRetryGate();
    gate.waitFor(600);
    gate.waitFor(1);
    vi.advanceTimersByTime(1000);
    expect(gate.closed()).toBe(false);
  });
});
