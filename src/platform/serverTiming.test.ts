import { describe, expect, it } from "vitest";
import { TIMING_PHASES, bootMs, createTimings, formatServerTiming, type TimingEntry } from "./serverTiming";

describe("formatServerTiming", () => {
  it("writes phase names and milliseconds, with the cold flag as a description", () => {
    expect(
      formatServerTiming([
        { phase: "boot", ms: 812.34 },
        { phase: "limiter", ms: 40 },
        { phase: "snapshot", ms: 1203.96, flag: "cold" },
        { phase: "total", ms: 3301 },
      ]),
    ).toBe("boot;dur=812.3, limiter;dur=40, snapshot;dur=1204;desc=cold, total;dur=3301");
  });

  it("is empty for no phases", () => {
    expect(formatServerTiming([])).toBe("");
  });

  it("drops a phase that is not on the list and a number that is not finite, and never goes below zero", () => {
    const entries = [
      { phase: "What is the address of the clinic?", ms: 5 },
      { phase: "embed", ms: Number.NaN },
      { phase: "rank", ms: Number.POSITIVE_INFINITY },
      { phase: "translate", ms: -3 },
    ] as unknown as TimingEntry[];
    expect(formatServerTiming(entries)).toBe("translate;dur=0");
  });

  it("carries nothing but the fixed names, digits and the one flag, whatever the entries hold", () => {
    const hostile = { phase: "snapshot", ms: 12, flag: "M001 a question in Urdu میری عمارت" } as unknown as TimingEntry;
    const header = formatServerTiming([hostile, { phase: "embed", ms: 150 }]);
    expect(header).toBe("snapshot;dur=12, embed;dur=150");
    const allowed = new RegExp(`^(?:(?:${TIMING_PHASES.join("|")});dur=\\d+(?:\\.\\d)?(?:;desc=cold)?(?:, )?)*$`);
    expect(header).toMatch(allowed);
  });
});

describe("createTimings", () => {
  it("keeps the phases in the order they were first recorded and adds up a phase recorded twice", () => {
    const timings = createTimings();
    timings.record("limiter", 10);
    timings.record("snapshot", 100, "cold");
    timings.record("limiter", 5);
    expect(timings.header()).toBe("limiter;dur=15, snapshot;dur=100;desc=cold");
    expect(timings.entries()).toEqual([
      { phase: "limiter", ms: 15 },
      { phase: "snapshot", ms: 100, flag: "cold" },
    ]);
  });
});

describe("bootMs", () => {
  it("is a number for the first request of an instance and null for every one after it", () => {
    const first = bootMs(performance.now() + 50);
    expect(typeof first).toBe("number");
    expect(first).toBeGreaterThanOrEqual(50);
    expect(bootMs()).toBeNull();
    expect(bootMs()).toBeNull();
  });
});
