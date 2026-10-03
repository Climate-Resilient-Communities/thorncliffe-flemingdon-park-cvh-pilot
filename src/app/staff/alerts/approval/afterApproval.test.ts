import { describe, expect, it, vi } from "vitest";
import { FEED_TAG } from "@/contracts/feedTag";
import type { ApprovalOutcome } from "@/modules/alerting";
import { afterApproval, type AfterApprovalDeps } from "./afterApproval";

const outcome = (feedVersion: number | null): ApprovalOutcome => ({ entry: {} as ApprovalOutcome["entry"], recipients: { total: 0, byLanguage: {} }, feedVersion });

function deps(over: Partial<AfterApprovalDeps> = {}) {
  const revalidate = vi.fn();
  const kickDispatcher = vi.fn();
  const log = vi.fn();
  return { revalidate, kickDispatcher, log, wired: { revalidate, kickDispatcher, log, ...over } as AfterApprovalDeps };
}

describe("what follows an approval that committed", () => {
  it("expires the feed's tag at once: revalidateTag('feed', { expire: 0 })", async () => {
    const d = deps();
    await afterApproval(outcome(8), d.wired);
    expect(FEED_TAG).toBe("feed");
    expect(d.revalidate).toHaveBeenCalledTimes(1);
    expect(d.revalidate).toHaveBeenCalledWith("feed", { expire: 0 });
  });

  it("revalidates nothing for a drill, which raised no feed version and changed nothing the web shows", async () => {
    const d = deps();
    await afterApproval(outcome(null), d.wired);
    expect(d.revalidate).not.toHaveBeenCalled();
  });

  it("kicks the dispatcher (E06's seam) once, after the commit, with no argument", async () => {
    const d = deps();
    await afterApproval(outcome(8), d.wired);
    expect(d.kickDispatcher).toHaveBeenCalledTimes(1);
    expect(d.kickDispatcher).toHaveBeenCalledWith();
  });

  it("never turns an approval that is done into a failure: what either throws is logged, without personal data, and the other still runs", async () => {
    const d = deps({
      revalidate: () => {
        throw new TypeError("the cache is gone");
      },
      kickDispatcher: vi.fn(() => {
        throw new RangeError("no lease");
      }),
    });
    await expect(afterApproval(outcome(8), d.wired)).resolves.toBeUndefined();
    expect(d.log).toHaveBeenCalledTimes(2);
    expect(JSON.parse(d.log.mock.calls[0][0])).toEqual({ evt: "approval.after_commit_failed", module: "alerting", step: "revalidate_feed", error: "TypeError" });
    expect(JSON.parse(d.log.mock.calls[1][0])).toEqual({ evt: "approval.after_commit_failed", module: "alerting", step: "kick_dispatcher", error: "RangeError" });
  });
});
