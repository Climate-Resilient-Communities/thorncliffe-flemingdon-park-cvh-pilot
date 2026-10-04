// What the approval view loads (S04.07), with the notice that all texts are paused (S06.06): the screen is the app's own `approvalScreen` over a fake
// use case, and the notice is the real `pauseNoticeForApprover` over a fake `paused`, so the sentence is the catalog's.
import { describe, expect, it, vi } from "vitest";
import { MessagingControlMissing } from "@/modules/messaging";
import { ALERT, APPROVER, ENTRY, PLANS, reviewOf, type ReviewOptions } from "../../../../../test/helpers/approvalReview";
import { pauseNoticeForApprover } from "../../pauseNotice";
import { loadApproval, refOfQuery, type ApprovalLoadDeps } from "./loadApproval";
import type { ApprovalScreen } from "./view";

const NOTICE = "Texts are paused; this will send when resumed";
const query = { alert: ALERT, entry: ENTRY };

function deps(options: { review?: ReviewOptions | null; paused?: () => Promise<boolean>; pauseNotice?: ApprovalLoadDeps["pauseNotice"] } = {}) {
  const logError = vi.fn();
  const review = vi.fn(async () => (options.review === null ? null : reviewOf(options.review)));
  const paused = vi.fn(options.paused ?? (async () => false));
  const pauseLog = vi.fn();
  const wired: ApprovalLoadDeps = {
    review,
    plans: async () => PLANS,
    pricePerSegmentCents: () => 1.5,
    residentAlertsEnabled: () => true,
    pauseNotice: options.pauseNotice ?? (() => pauseNoticeForApprover({ paused, logError: pauseLog })),
    sending: async () => null,
    logError,
  };
  return { wired, review, paused, pauseLog, logError };
}

const screen = (loaded: unknown) => loaded as ApprovalScreen;

describe("what the approval view loads", () => {
  it("reads the entry the query names, and nothing from a request but its two ids", async () => {
    const d = deps();
    const loaded = screen(await loadApproval({ alert: [ALERT, "other"], entry: ENTRY, extra: "ignored" } as never, APPROVER, d.wired));
    expect(d.review).toHaveBeenCalledWith({ alertId: ALERT, entryId: ENTRY });
    expect(refOfQuery({})).toEqual({ alertId: "", entryId: "" });
    expect(loaded).toMatchObject({ variant: "alert", status: "review", ref: { alertId: ALERT, entryId: ENTRY } });
  });

  it("is the screen for an entry that is not there when the use case finds none, and asks nothing of the pause", async () => {
    const d = deps({ review: null });
    expect(await loadApproval(query, APPROVER, d.wired)).toMatchObject({ kind: "missing" });
    expect(d.paused).not.toHaveBeenCalled();
  });
});

describe("the notice that all texts are paused, on the approval view and its confirmation (S06.06)", () => {
  it("shows the catalog's sentence on the approval view while texts are paused, and the view is otherwise what it is without it", async () => {
    const paused = screen(await loadApproval(query, APPROVER, deps({ paused: async () => true }).wired));
    const running = screen(await loadApproval(query, APPROVER, deps().wired));
    expect(paused.pauseNotice).toBe(NOTICE);
    expect(running.pauseNotice).toBeNull();
    expect({ ...paused, pauseNotice: null }).toEqual(running);
    expect(paused).toMatchObject({ status: "review" });
  });

  it("shows it on the confirmation, the screen of the entry the approver has just approved, and nothing when it answers null", async () => {
    const paused = screen(await loadApproval(query, APPROVER, deps({ review: { entry: { status: "approved" } }, paused: async () => true }).wired));
    expect(paused).toMatchObject({ status: "locked", locked: { message: "This alert was approved and is published." }, pauseNotice: NOTICE });
    const running = screen(await loadApproval(query, APPROVER, deps({ review: { entry: { status: "approved" } } }).wired));
    expect(running.pauseNotice).toBeNull();
  });

  it("never keeps the view from loading when the switch cannot be read: it is shown without the notice, and the failure is logged by name", async () => {
    const d = deps({
      paused: async () => {
        throw new TypeError("connection reset");
      },
    });
    const loaded = screen(await loadApproval(query, APPROVER, d.wired));
    expect(loaded).toMatchObject({ status: "review", pauseNotice: null });
    expect(d.pauseLog).toHaveBeenCalledWith("messaging.pause_notice_failed", { error: "TypeError" });
  });

  it("says the texts are held when the switch has no row (the sender holds every text then), and still loads", async () => {
    const d = deps({
      paused: async () => {
        throw new MessagingControlMissing();
      },
    });
    expect(screen(await loadApproval(query, APPROVER, d.wired)).pauseNotice).toBe(NOTICE);
  });

  it("never keeps the view from loading even when reading the notice throws outright: it is logged and the view is shown without it", async () => {
    const d = deps({
      pauseNotice: async () => {
        throw new RangeError("the composition is gone");
      },
    });
    const loaded = screen(await loadApproval(query, APPROVER, d.wired));
    expect(loaded).toMatchObject({ status: "review", pauseNotice: null });
    expect(d.logError).toHaveBeenCalledWith("approval.pause_notice_failed", { error: "RangeError" });
  });
});
