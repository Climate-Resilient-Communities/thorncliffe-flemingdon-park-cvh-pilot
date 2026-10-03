// The warning before a translation model's monthly limit (owner decision 45): when it counts, when it warns, and that it
// never counts inside a search. Fakes for the count, the ops event and `after()`; the database side is in test/db/search.db.test.ts.
import { describe, expect, it, vi } from "vitest";
import type { SpendEventInput } from "@/modules/spend";
import { createTranslateQuotaWatch, torontoMonth } from "./translateQuota";

const NORTH = "north-small-translate-09-2026";
const COMMAND = "command-a-translate-08-2025";
const translateRow = (model: string): SpendEventInput => ({ kind: "translate", purpose: "search", model, releaseV: 3, tokens: 35 });
const embedRow: SpendEventInput = { kind: "embed", purpose: "search", model: NORTH, releaseV: 3, tokens: 7 };

/** A watch over fakes. `defer` keeps the work, so a test decides when "after the response" is. */
function watch(options: { limits?: Record<string, number>; calls?: Record<string, number>; now?: () => Date; warnFails?: boolean; countFails?: boolean } = {}) {
  const calls = { ...options.calls };
  const count = vi.fn(async (model: string) => {
    if (options.countFails) throw new Error("the count failed");
    return calls[model] ?? 0;
  });
  const warn = vi.fn<(model: string) => Promise<void>>(async () => {
    if (options.warnFails) throw new Error("the ops event failed");
  });
  const pending: (() => Promise<unknown>)[] = [];
  const defer = vi.fn((work: () => Promise<unknown>) => void pending.push(work));
  const onSpend = createTranslateQuotaWatch({ limits: options.limits ?? { [NORTH]: 1000 }, count, warn, defer, now: options.now ?? (() => new Date("2026-10-15T15:00:00Z")) });
  /** Everything handed to `defer` so far runs now, and settles. */
  const afterResponse = async () => {
    const work = pending.splice(0);
    await Promise.all(work.map((w) => w()));
  };
  return { onSpend, count, warn, defer, calls, afterResponse };
}

describe("the translation quota warning", () => {
  it("does nothing for a row that is not a translation, or for a model with no configured limit", async () => {
    const w = watch({ calls: { [NORTH]: 999, [COMMAND]: 999 } });

    w.onSpend(embedRow);
    w.onSpend(translateRow(COMMAND));
    w.onSpend(translateRow("constructor")); // not a limit of ours, though a name on every object
    w.onSpend(translateRow("toString"));
    await w.afterResponse();

    expect(w.defer).not.toHaveBeenCalled();
    expect(w.count).not.toHaveBeenCalled();
    expect(w.warn).not.toHaveBeenCalled();
  });

  it("returns at once and counts only after the response: nothing is counted before the deferred work runs", async () => {
    const w = watch({ calls: { [NORTH]: 900 } });

    w.onSpend(translateRow(NORTH));

    expect(w.defer).toHaveBeenCalledTimes(1);
    expect(w.count).not.toHaveBeenCalled(); // not in the search's time
    expect(w.warn).not.toHaveBeenCalled();

    await w.afterResponse();

    expect(w.count).toHaveBeenCalledTimes(1);
    expect(w.count).toHaveBeenCalledWith(NORTH, new Date("2026-10-15T15:00:00Z"));
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it("is silent below 80% of the limit and warns at 80%: 799 of 1000 does not, 800 does, with the model", async () => {
    const below = watch({ calls: { [NORTH]: 799 } });
    below.onSpend(translateRow(NORTH));
    await below.afterResponse();
    expect(below.count).toHaveBeenCalledTimes(1);
    expect(below.warn).not.toHaveBeenCalled();

    const at = watch({ calls: { [NORTH]: 800 } });
    at.onSpend(translateRow(NORTH));
    await at.afterResponse();
    expect(at.warn.mock.calls).toEqual([[NORTH]]);
  });

  it("works in whole numbers for any limit: 8 of 10 warns and 7 does not, and a limit of 1 warns at its first call", async () => {
    for (const [limit, used, warns] of [
      [10, 7, false],
      [10, 8, true],
      [1, 0, false],
      [1, 1, true],
      [650, 519, false],
      [650, 520, true],
    ] as const) {
      const w = watch({ limits: { [NORTH]: limit }, calls: { [NORTH]: used } });
      w.onSpend(translateRow(NORTH));
      await w.afterResponse();
      expect(w.warn.mock.calls.length, `${used} of ${limit}`).toBe(warns ? 1 : 0);
    }
  });

  it("warns once per model per month: after the warning no more rows are counted, and another model is its own", async () => {
    const w = watch({ limits: { [NORTH]: 1000, [COMMAND]: 100 }, calls: { [NORTH]: 900, [COMMAND]: 50 } });

    w.onSpend(translateRow(NORTH));
    await w.afterResponse();
    expect(w.warn.mock.calls).toEqual([[NORTH]]);

    // Further rows of the warned model: nothing deferred, nothing counted, nothing told.
    w.defer.mockClear();
    w.count.mockClear();
    w.onSpend(translateRow(NORTH));
    w.onSpend(translateRow(NORTH));
    await w.afterResponse();
    expect(w.defer).not.toHaveBeenCalled();
    expect(w.count).not.toHaveBeenCalled();

    // The other model has its own count and its own warning.
    w.onSpend(translateRow(COMMAND));
    await w.afterResponse();
    expect(w.warn.mock.calls).toEqual([[NORTH]]); // 50 of 100 is below 80%
    w.calls[COMMAND] = 80;
    w.onSpend(translateRow(COMMAND));
    await w.afterResponse();
    expect(w.warn.mock.calls).toEqual([[NORTH], [COMMAND]]);
  });

  it("warns once even when many rows are counted at the same time", async () => {
    const w = watch({ calls: { [NORTH]: 900 } });

    for (let i = 0; i < 5; i++) w.onSpend(translateRow(NORTH));
    await w.afterResponse();

    expect(w.count).toHaveBeenCalledTimes(5); // all five were handed over before the first warned
    expect(w.warn).toHaveBeenCalledTimes(1);
  });

  it("warns again in the next calendar month in Toronto: the month turns at midnight there, not in UTC", async () => {
    let now = new Date("2026-10-31T03:59:00Z"); // 23:59 on October 31st in Toronto (EDT)
    const w = watch({ calls: { [NORTH]: 900 }, now: () => now });

    w.onSpend(translateRow(NORTH));
    await w.afterResponse();
    expect(w.warn).toHaveBeenCalledTimes(1);

    now = new Date("2026-11-01T03:59:00Z"); // still October in Toronto: warned already
    w.onSpend(translateRow(NORTH));
    await w.afterResponse();
    expect(w.warn).toHaveBeenCalledTimes(1);

    now = new Date("2026-11-01T04:00:00Z"); // 00:00 on November 1st in Toronto
    w.onSpend(translateRow(NORTH));
    await w.afterResponse();
    expect(w.count).toHaveBeenLastCalledWith(NORTH, new Date("2026-11-01T04:00:00Z")); // counted over the new month
    expect(w.warn).toHaveBeenCalledTimes(2);
  });

  it("tries again with the next row when the ops event could not be written", async () => {
    const w = watch({ calls: { [NORTH]: 900 }, warnFails: true });

    w.onSpend(translateRow(NORTH));
    await expect(w.afterResponse()).resolves.toBeUndefined(); // the deferred work never rejects
    w.onSpend(translateRow(NORTH));
    await w.afterResponse();

    expect(w.warn).toHaveBeenCalledTimes(2);
  });

  it("changes nothing for the search when the count fails, and tries again with the next row", async () => {
    const w = watch({ calls: { [NORTH]: 900 }, countFails: true });

    w.onSpend(translateRow(NORTH));
    await expect(w.afterResponse()).resolves.toBeUndefined();
    w.onSpend(translateRow(NORTH));
    await w.afterResponse();

    expect(w.count).toHaveBeenCalledTimes(2);
    expect(w.warn).not.toHaveBeenCalled();
  });
});

describe("torontoMonth", () => {
  it("names the calendar month in America/Toronto, across the clock changes", () => {
    expect(torontoMonth(new Date("2026-10-15T15:00:00Z"))).toBe("2026-10");
    expect(torontoMonth(new Date("2026-10-01T03:59:00Z"))).toBe("2026-09"); // 23:59 on September 30th (EDT)
    expect(torontoMonth(new Date("2026-10-01T04:00:00Z"))).toBe("2026-10");
    expect(torontoMonth(new Date("2026-12-01T04:59:00Z"))).toBe("2026-11"); // 23:59 on November 30th (EST)
    expect(torontoMonth(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12");
  });
});
