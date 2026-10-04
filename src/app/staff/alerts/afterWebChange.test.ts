import { describe, expect, it, vi } from "vitest";
import { afterSubmit, expireFeed, type AfterWebChangeDeps } from "./afterWebChange";

function deps(over: Partial<AfterWebChangeDeps> = {}) {
  const revalidate = vi.fn();
  const log = vi.fn();
  return { revalidate, log, wired: { revalidate, log, ...over } as AfterWebChangeDeps };
}

describe("what follows a commit that changed what residents read without an approval (S08.03)", () => {
  it("expires the feed's tag at once: revalidateTag('feed', { expire: 0 })", () => {
    const d = deps();
    expireFeed(d.wired);
    expect(d.revalidate).toHaveBeenCalledTimes(1);
    expect(d.revalidate).toHaveBeenCalledWith("feed", { expire: 0 });
  });

  it("never turns a change that is done into a failure: what it throws is logged, without personal data", () => {
    const d = deps({
      revalidate: () => {
        throw new TypeError("the cache is gone for +1 416 555 0100");
      },
    });
    expect(() => expireFeed(d.wired)).not.toThrow();
    expect(d.log).toHaveBeenCalledTimes(1);
    expect(d.log.mock.calls[0][0]).not.toContain("416");
    expect(JSON.parse(d.log.mock.calls[0][0])).toMatchObject({ evt: "web_change.after_commit_failed", error: "TypeError" });
  });

  it("expires the feed after a submit that put a D-1 post on the web, and after nothing else", () => {
    const published = deps();
    afterSubmit({ state: "committed", webPublished: true }, published.wired);
    expect(published.revalidate).toHaveBeenCalledWith("feed", { expire: 0 });

    for (const report of [{ state: "committed" }, { state: "committed", webPublished: false }, { state: "failed", webPublished: true }, { state: "refused" }, { state: "running" }]) {
      const other = deps();
      afterSubmit(report, other.wired);
      expect(other.revalidate).not.toHaveBeenCalled();
    }
  });
});
