import { describe, expect, it, vi } from "vitest";
import type { OnDutyState } from "@/modules/ops";
import { onDutyNoticeFor, type OnDutyNoticeDeps } from "./onDutyNotice";

const NOTICE = /^Nobody is on duty for check-ins\. .*On-call numbers page\.$/;

function deps(state: OnDutyState["kind"], roundTypes: string[] = ["heat", "power"]): OnDutyNoticeDeps & { asked: ReturnType<typeof vi.fn> } {
  const asked = vi.fn();
  return {
    asked,
    roundTypes: async () => roundTypes,
    onDuty: async () => {
      asked();
      return state === "none" ? { kind: "none" } : { kind: state, entryId: "e", staffId: "s" };
    },
  };
}

describe("the approval view's warning that nobody is on duty for check-ins (S08.08, E08 'On-duty Admin')", () => {
  it("warns for an acknowledgement, update or correction of a round type while nobody is on duty, or the one on duty no longer can be", async () => {
    for (const kind of ["ack", "update", "correction"]) {
      expect(await onDutyNoticeFor({ kind, types: ["heat"], isDrill: false }, deps("none"))).toMatch(NOTICE);
      expect(await onDutyNoticeFor({ kind, types: ["elevator", "power"], isDrill: false }, deps("stale"))).toMatch(NOTICE);
    }
  });

  it("says nothing while an Admin is on duty", async () => {
    expect(await onDutyNoticeFor({ kind: "ack", types: ["heat"], isDrill: false }, deps("set"))).toBeNull();
  });

  it("says nothing for an entry that starts no round, and does not read the roster for it: another type, a drill, a withdrawal or a final", async () => {
    for (const entry of [
      { kind: "ack", types: ["elevator"], isDrill: false },
      { kind: "ack", types: ["heat"], isDrill: true },
      { kind: "withdrawal", types: ["heat"], isDrill: false },
      { kind: "final", types: ["heat"], isDrill: false },
    ]) {
      const d = deps("none");
      expect(await onDutyNoticeFor(entry, d)).toBeNull();
      expect(d.asked).not.toHaveBeenCalled();
    }
    // The round types are the Hub's (S08.06): an Admin who made elevator one gets the warning for it.
    expect(await onDutyNoticeFor({ kind: "ack", types: ["elevator"], isDrill: false }, deps("none", ["elevator"]))).toMatch(NOTICE);
  });
});
