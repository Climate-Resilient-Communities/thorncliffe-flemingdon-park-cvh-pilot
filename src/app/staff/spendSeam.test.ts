// The sentence an approver reads before approving when the cap would be passed (S07.08): the real `capNoticeFor` over fake figures, so the words are the catalog's.
import { describe, expect, it, vi } from "vitest";
import { capNoticeFor, type CapNoticeDeps } from "./spendSeam";

function deps(over: Partial<CapNoticeDeps> = {}) {
  const logError = vi.fn();
  const wired: CapNoticeDeps = {
    capCents: async () => 10_000,
    spentCents: async () => 9_000,
    queuedCents: async () => 0,
    now: () => new Date("2026-10-15T15:00:00Z"),
    logError,
    ...over,
  };
  return { wired, logError };
}

describe("the notice that approving would pass the monthly cap", () => {
  it("says nothing just under the cap and nothing exactly at it", async () => {
    expect(await capNoticeFor(999, deps().wired)).toBeNull();
    expect(await capNoticeFor(1_000, deps().wired)).toBeNull();
  });

  it("states the shortfall, the cap and where the month would end, just over the cap, and says the alert can still be approved", async () => {
    expect(await capNoticeFor(1_001, deps().wired)).toBe(
      "With this alert, text spending this month would be about $100.01 CAD, which is $0.01 CAD over the monthly cap of $100.00 CAD. You can still approve it: the texts are sent, the overrun is recorded and the on-call Admins are told.",
    );
  });

  it("counts the texts still waiting to be sent", async () => {
    expect(await capNoticeFor(600, deps({ queuedCents: async () => 500 }).wired)).toContain("$1.00 CAD over");
  });

  it("says nothing while no cap is set, and nothing for an entry with no estimate", async () => {
    expect(await capNoticeFor(50_000, deps({ capCents: async () => null }).wired)).toBeNull();
    expect(await capNoticeFor(null, deps().wired)).toBeNull();
    expect(await capNoticeFor(0, deps().wired)).toBeNull();
  });

  it("reads the month at the time it is asked", async () => {
    const spentCents = vi.fn(async () => 0);
    await capNoticeFor(10, deps({ spentCents }).wired);
    expect(spentCents).toHaveBeenCalledWith(new Date("2026-10-15T15:00:00Z"));
  });

  it("never blocks: when the figures cannot be read it says nothing and logs the error's name", async () => {
    const d = deps({
      spentCents: async () => {
        throw new TypeError("connection reset");
      },
    });
    expect(await capNoticeFor(1_001, d.wired)).toBeNull();
    expect(d.logError).toHaveBeenCalledWith("approval.cap_notice_failed", { error: "TypeError" });
  });
});
