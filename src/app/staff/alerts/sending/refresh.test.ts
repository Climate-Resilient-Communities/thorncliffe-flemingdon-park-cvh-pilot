import { describe, expect, it, vi } from "vitest";
import { startRefresh, type RefreshTimers } from "./refresh";

/** A clock that only moves when told to: the callbacks it was given, run for each interval that has passed. */
function fakeTimers() {
  let now = 0;
  const jobs = new Map<number, { callback: () => void; ms: number; next: number }>();
  let id = 0;
  const timers: RefreshTimers = {
    set: (callback, ms) => {
      id += 1;
      jobs.set(id, { callback, ms, next: now + ms });
      return id;
    },
    clear: (handle) => void jobs.delete(handle as number),
  };
  return {
    timers,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs.values()].filter((job) => job.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        now = due.next;
        due.next += due.ms;
        due.callback();
      }
      now = end;
    },
    active: () => jobs.size,
  };
}

describe("the sending progress reloading itself", () => {
  it("refreshes every 15 seconds: not at 14.9, once at 15, twice at 30", () => {
    const clock = fakeTimers();
    const refresh = vi.fn();
    startRefresh(refresh, 15, () => true, clock.timers);
    clock.advance(14_999);
    expect(refresh).not.toHaveBeenCalled();
    clock.advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    clock.advance(15_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    clock.advance(60_000);
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it("does not refresh while the page is hidden, and carries on when it is shown again", () => {
    const clock = fakeTimers();
    const refresh = vi.fn();
    let visible = false;
    startRefresh(refresh, 15, () => visible, clock.timers);
    clock.advance(45_000);
    expect(refresh).not.toHaveBeenCalled();
    visible = true;
    clock.advance(15_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops when it is stopped, and leaves no timer behind", () => {
    const clock = fakeTimers();
    const refresh = vi.fn();
    const stop = startRefresh(refresh, 15, () => true, clock.timers);
    expect(clock.active()).toBe(1);
    stop();
    expect(clock.active()).toBe(0);
    clock.advance(120_000);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refuses an interval that is not a whole number of seconds, 1 or more, so a page cannot refresh in a tight loop", () => {
    for (const seconds of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => startRefresh(vi.fn(), seconds, () => true, fakeTimers().timers), String(seconds)).toThrow(RangeError);
    }
  });

  it("uses the real timers and the page's visibility by default", () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn();
      const stop = startRefresh(refresh, 15);
      vi.advanceTimersByTime(15_000);
      expect(refresh).toHaveBeenCalledTimes(1);
      stop();
      vi.advanceTimersByTime(60_000);
      expect(refresh).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
