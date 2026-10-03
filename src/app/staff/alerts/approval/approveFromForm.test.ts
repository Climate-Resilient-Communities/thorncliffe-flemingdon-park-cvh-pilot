import { describe, expect, it, vi } from "vitest";
import { decodeCounts, encodeCounts, type RecipientCounts } from "@/contracts/alertApproval";
import type { AlertRefusal, ApprovalOutcome, EntryView } from "@/modules/alerting";
import { ALERT, ENTRY, HASH, reviewOf } from "../../../../../test/helpers/approvalReview";
import { approvalRefusalMessage, approveFromForm, discardFromForm, returnFromForm, type ApprovalDeps } from "./approveFromForm";

const session = { staffId: "01900000-0000-7000-8000-0000000000c2", aal: "aal2" as const };
const REVIEWED: RecipientCounts = { total: 5, byLanguage: { en: 3, ur: 2 } };

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};
const refs: Array<[string, string]> = [["alert", ALERT], ["entry", ENTRY], ["version", "2"], ["hash", HASH]];
const approveForm = (reviewed: RecipientCounts = REVIEWED, extra: Array<[string, string]> = []) => form([...refs, ["reviewed", encodeCounts(reviewed)], ...extra]);

const outcome = (feedVersion: number | null = 8): ApprovalOutcome => ({ entry: { id: ENTRY, alertId: ALERT } as unknown as EntryView, recipients: REVIEWED, feedVersion });

function deps(options: { approve?: unknown; ret?: unknown; discard?: unknown; review?: unknown } = {}) {
  const approveEntry = vi.fn<(actor: unknown, ref: unknown, shown: unknown) => Promise<unknown>>(async () => options.approve ?? { ok: true, value: outcome() });
  const returnEntry = vi.fn<(actor: unknown, ref: unknown, reason: string, options: unknown) => Promise<unknown>>(async () => options.ret ?? { ok: true, value: {} });
  const discardEntry = vi.fn<(actor: unknown, ref: unknown, options: unknown) => Promise<unknown>>(async () => options.discard ?? { ok: true, value: {} });
  const review = vi.fn(async () => (options.review === undefined ? reviewOf({ recipients: { open: true, ...REVIEWED } }) : options.review));
  const refuseInvalidForm = vi.fn<(actor: unknown, form: string, ref: unknown) => Promise<void>>(async () => undefined);
  const afterApproval = vi.fn(async () => undefined);
  const wired: ApprovalDeps = {
    alerting: () => ({ approveEntry, returnEntry, discardEntry, review, refuseInvalidForm }) as unknown as ReturnType<ApprovalDeps["alerting"]>,
    afterApproval,
    pricePerSegmentCents: () => 1.5,
  };
  return { approveEntry, returnEntry, discardEntry, review, refuseInvalidForm, afterApproval, wired };
}

describe("Approve", () => {
  it("names the entry, the version and hash that were shown and the count reviewed, as the person and the session's level, and goes back to the page", async () => {
    const d = deps();
    const state = await approveFromForm(d.wired, session, approveForm());
    expect(state).toEqual({ status: "done", location: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}` });
    expect(d.approveEntry).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, { version: 2, contentHash: HASH, recipients: REVIEWED });
  });

  it("does what must follow a commit once, with the outcome, and only after the use case answered", async () => {
    const order: string[] = [];
    const d = deps();
    d.approveEntry.mockImplementation(async () => {
      order.push("approve");
      return { ok: true, value: outcome(9) };
    });
    d.afterApproval.mockImplementation(async () => void order.push("after"));
    await approveFromForm(d.wired, session, approveForm());
    expect(order).toEqual(["approve", "after"]);
    expect(d.afterApproval).toHaveBeenCalledTimes(1);
    expect(d.afterApproval).toHaveBeenCalledWith(outcome(9));
  });

  it.each<[AlertRefusal, string]>([
    ["ENTRY_CHANGED", "This alert changed. Review it again."],
    ["VALID_UNTIL_PAST", "This alert's valid-until has passed. The author must return it to draft and set a new time."],
    ["EDITOR_CANNOT_APPROVE", "You wrote or changed this alert, so a second person has to approve it."],
    ["AAL2_REQUIRED", "Approving needs a sign-in confirmed with your authenticator. Sign out, sign in again and enter your code."],
    ["ENTRY_NOT_PENDING", "This alert is no longer waiting for approval. Reload the page to see what happened."],
    ["AUTHOR_NOT_ALLOWED", "Its author can no longer write this alert, because their role or buildings changed, so it cannot be approved. Return it or discard it."],
  ])("refuses with the reason in words when the use case refuses with %s, and does nothing after", async (error, message) => {
    const d = deps({ approve: { ok: false, error } });
    expect(await approveFromForm(d.wired, session, approveForm())).toEqual({ status: "refused", message });
    expect(d.afterApproval).not.toHaveBeenCalled();
  });

  it("says that the number of people changed, shows the new number per language and its cost, and does not follow a commit that did not happen", async () => {
    const snapshot: RecipientCounts = { total: 7, byLanguage: { en: 3, ur: 4 } };
    const d = deps({ approve: { ok: false, error: "RECIPIENT_COUNT_CHANGED", detail: { recipients: snapshot } } });
    const state = await approveFromForm(d.wired, session, approveForm());
    expect(state).toMatchObject({
      status: "count_changed",
      view: {
        message: "The number of people who will get this text changed from 5 to 7",
        rows: [
          { lang: "en", n: 3 },
          { lang: "ur", n: 4 },
        ],
        cost: "Estimated cost now: $0.33 CAD (an estimate)",
      },
    });
    // The new count is what the next Approve names.
    const view = (state as { view: { reviewed: string } }).view;
    expect(decodeCounts(view.reviewed)).toEqual(snapshot);
    expect(d.afterApproval).not.toHaveBeenCalled();
    // Pressing Approve again with the new count goes through.
    const again = deps();
    expect(await approveFromForm(again.wired, session, approveForm(snapshot))).toMatchObject({ status: "done" });
    expect(again.approveEntry).toHaveBeenCalledWith(expect.anything(), expect.anything(), { version: 2, contentHash: HASH, recipients: snapshot });
  });

  it("names the entry that covered the thread when the \"Now also for\" line was read, and refuses a form whose covering is not an id", async () => {
    const covering = "01900000-0000-7000-8000-00000000c0e1";
    const d = deps();
    await approveFromForm(d.wired, session, approveForm(REVIEWED, [["covering", covering]]));
    expect(d.approveEntry).toHaveBeenCalledWith(expect.anything(), expect.anything(), { version: 2, contentHash: HASH, recipients: REVIEWED, covering });
    const bad = deps();
    expect(await approveFromForm(bad.wired, session, approveForm(REVIEWED, [["covering", "not an id"]]))).toMatchObject({ status: "refused" });
    expect(bad.approveEntry).not.toHaveBeenCalled();
    expect(bad.refuseInvalidForm).toHaveBeenCalledTimes(1);
  });

  it("refuses a form that does not carry what was shown: no version, a hash that is not one, no count, a count that does not add up", async () => {
    for (const bad of [
      form([["alert", ALERT], ["entry", ENTRY], ["hash", HASH], ["reviewed", encodeCounts(REVIEWED)]]),
      form([["alert", ALERT], ["entry", ENTRY], ["version", "two"], ["hash", HASH], ["reviewed", encodeCounts(REVIEWED)]]),
      form([...refs.slice(0, 3), ["hash", "abc"], ["reviewed", encodeCounts(REVIEWED)]]),
      form(refs),
      form([...refs, ["reviewed", '{"v":1,"total":9,"by_lang":{"en":3}}']]),
      form([...refs, ["reviewed", "not json"]]),
    ]) {
      const d = deps();
      expect(await approveFromForm(d.wired, session, bad)).toEqual({ status: "refused", message: "That could not be done. Reload the page and try again." });
      expect(d.approveEntry).not.toHaveBeenCalled();
      // The refusal is recorded all the same (every refusal is, with its reason): by this person, for an approval, on the entry the form names.
      expect(d.refuseInvalidForm).toHaveBeenCalledTimes(1);
      expect(d.refuseInvalidForm).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, "approve", { alertId: ALERT, entryId: ENTRY });
      expect(d.afterApproval).not.toHaveBeenCalled();
    }
  });

  it("records nothing as an invalid form for a form that carries what was shown", async () => {
    const d = deps();
    await approveFromForm(d.wired, session, approveForm());
    expect(d.refuseInvalidForm).not.toHaveBeenCalled();
  });

  it("is refused when the entry is gone by the time the new count is wanted", async () => {
    const d = deps({ approve: { ok: false, error: "RECIPIENT_COUNT_CHANGED", detail: { recipients: { total: 1, byLanguage: { en: 1 } } } }, review: null });
    expect(await approveFromForm(d.wired, session, approveForm())).toEqual({ status: "refused", message: "That alert was not found." });
  });
});

describe("Return to author", () => {
  it("sends the note with what was shown, as a return, and goes back to the page", async () => {
    const d = deps();
    const state = await returnFromForm(d.wired, session, form([...refs, ["note", "Say which floors."]]));
    expect(state).toEqual({ status: "done", location: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}` });
    expect(d.returnEntry).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, "return", { shown: { version: 2, contentHash: HASH }, note: "Say which floors." });
    // Returning is not approving: nothing follows it.
    expect(d.afterApproval).not.toHaveBeenCalled();
  });

  it.each<[AlertRefusal, string]>([
    ["NOTE_REQUIRED", "Write a note for the author."],
    ["NOTE_TOO_LONG", "The note is too long: at most 500 characters."],
    ["ENTRY_CHANGED", "This alert changed. Review it again."],
  ])("says why when the use case refuses with %s", async (error, message) => {
    const d = deps({ ret: { ok: false, error } });
    expect(await returnFromForm(d.wired, session, form([...refs, ["note", ""]]))).toEqual({ status: "refused", message });
  });

  it("passes no note when the form has none (the use case refuses it) and refuses a form without what was shown", async () => {
    const d = deps({ ret: { ok: false, error: "NOTE_REQUIRED" } });
    await returnFromForm(d.wired, session, form(refs));
    expect(d.returnEntry).toHaveBeenCalledWith(expect.anything(), expect.anything(), "return", { shown: { version: 2, contentHash: HASH }, note: "" });
    const bare = deps();
    expect(await returnFromForm(bare.wired, session, form([["alert", ALERT], ["entry", ENTRY], ["note", "Hi"]]))).toMatchObject({ status: "refused" });
    expect(bare.returnEntry).not.toHaveBeenCalled();
    expect(bare.refuseInvalidForm).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, "return", { alertId: ALERT, entryId: ENTRY });
  });
});

describe("Discard", () => {
  it("discards with what was shown and goes back to the page", async () => {
    const d = deps();
    expect(await discardFromForm(d.wired, session, form(refs))).toEqual({ status: "done", location: `/staff/alerts/approve?alert=${ALERT}&entry=${ENTRY}` });
    expect(d.discardEntry).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, { alertId: ALERT, entryId: ENTRY }, { shown: { version: 2, contentHash: HASH } });
    expect(d.afterApproval).not.toHaveBeenCalled();
  });

  it("says why it was refused, and refuses a form without what was shown", async () => {
    const d = deps({ discard: { ok: false, error: "ENTRY_CHANGED" } });
    expect(await discardFromForm(d.wired, session, form(refs))).toEqual({ status: "refused", message: "This alert changed. Review it again." });
    const bare = deps();
    expect(await discardFromForm(bare.wired, session, form([["alert", ALERT], ["entry", ENTRY]]))).toMatchObject({ status: "refused" });
    expect(bare.discardEntry).not.toHaveBeenCalled();
    expect(bare.refuseInvalidForm).toHaveBeenCalledWith({ staffId: session.staffId, aal: "aal2" }, "discard", { alertId: ALERT, entryId: ENTRY });
  });
});

describe("approvalRefusalMessage", () => {
  it("is the view's wording where it has some and a general line for anything else", () => {
    expect(approvalRefusalMessage("ENTRY_CHANGED")).toBe("This alert changed. Review it again.");
    expect(approvalRefusalMessage("ONCALL_REQUIRED")).toBe("No on-call number is set, so this alert cannot be approved yet. An Admin adds one on the On-call numbers page. Nothing was approved.");
    expect(approvalRefusalMessage("SOMETHING_ELSE")).toBe("That could not be done. Reload the page and try again.");
  });
});
