// The approval view of a correction or a withdrawal (S05.02): the approver is shown the entry it replaces as residents read it now, what residents will see in its place,
// that it goes to everyone who got the original and to everyone in its own audience, the reason of a withdrawal, whether approving it closes the alert, and that it cannot
// be approved when the entry was corrected or withdrawn since.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APPROVER, PLANS, reviewOf } from "../../../../../test/helpers/approvalReview";
import { ApprovalBody, type ApprovalActions } from "./ApprovalBody";
import { APPROVAL_MESSAGE_CODES, approvalScreen, type ApprovalScreen } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: ApprovalActions = { approve: noop, returnToAuthor: noop, discard: noop };

const TARGET = { id: "01900000-0000-7000-8000-00000000c0e1", kind: "update" as const, status: "approved" as const, text: "Power is back on floors 1 to 4.", phase: "in_progress" as const, publishedAt: new Date("2026-10-04T14:40:00.000Z"), valid: true, audience: reviewOf().entry.content.audience };

const screenOf = (entry: Record<string, unknown>, extra: Parameters<typeof reviewOf>[0] = {}): ApprovalScreen =>
  approvalScreen({ review: reviewOf({ target: TARGET, ...extra, entry: entry as never }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
const html = (screen: ApprovalScreen) => renderToStaticMarkup(<ApprovalBody screen={screen} actions={actions} />);

describe("the approval of a correction", () => {
  const screen = screenOf({ kind: "correction", supersedesId: TARGET.id });

  it("is titled as a correction and shows the entry it replaces, as residents read it now, with its time", () => {
    expect(screen.title).toBe("Approve a correction");
    expect(screen.lead).toContain("in place of the entry below");
    expect(screen.replaces).toEqual({
      title: "What this replaces",
      lead: 'Residents read this above the entry it corrects. The entry stays readable below it, marked "Corrected".',
      target: { heading: expect.stringMatching(/^Update, Sunday, October 4, 2026 at 10:40 a\.m\. EDT$/), text: "Power is back on floors 1 to 4." },
      reason: null,
      reach: "This goes to everyone who got the original, and to everyone in the audience above.",
      closes: null,
      gone: null,
    });
  });

  it("is drawn with the entry, what residents will see, and that it goes to everyone who got the original, before the new text", () => {
    const out = html(screen);
    expect(out).toContain('data-testid="replaces"');
    expect(out).toContain('data-testid="replaces-text">Power is back on floors 1 to 4.</p>');
    expect(out).toMatch(/data-testid="replaces-reach">This goes to everyone who got the original, and to everyone in the audience above\./);
    expect(out).not.toContain('data-testid="replaces-reason"');
    expect(out).not.toContain('data-testid="replaces-closes"');
    expect(out).not.toContain('data-testid="replaces-gone"');
    expect(out.indexOf('data-testid="replaces"')).toBeLessThan(out.indexOf('data-testid="english-text"'));
  });
});

describe("the approval of a withdrawal", () => {
  const screen = screenOf({ kind: "withdrawal", supersedesId: TARGET.id, withdrawalReason: "wrong_place" });

  it("is titled as a withdrawal and says what residents will read in the place of the entry, and why", () => {
    expect(screen.title).toBe("Approve a withdrawal");
    expect(screen.replaces?.lead).toBe('Residents read "Withdrawn" and the reason in the place of this entry.');
    expect(screen.replaces?.reason).toBe("Reason: Wrong place");
    expect(screen.replaces?.reach).toContain("everyone who got the original");
    expect(html(screen)).toContain('data-testid="replaces-reason">Reason: Wrong place</p>');
  });

  it("names each reason of the catalog in words", () => {
    const reasons = (["wrong_place", "wrong_information", "duplicate", "other"] as const).map((reason) => screenOf({ kind: "withdrawal", supersedesId: TARGET.id, withdrawalReason: reason }).replaces?.reason);
    expect(reasons).toEqual(["Reason: Wrong place", "Reason: Wrong information", "Reason: Duplicate of another alert", "Reason: Other (write the reason)"]);
  });

  it("says before the approval that it closes the alert as withdrawn when nothing else is left for residents to read", () => {
    const closing = screenOf({ kind: "withdrawal", supersedesId: TARGET.id, withdrawalReason: "duplicate" }, { closesThread: true });
    expect(closing.replaces?.closes).toContain("closes the alert as withdrawn");
    expect(html(closing)).toContain('data-testid="replaces-closes"');
    expect(screen.replaces?.closes).toBeNull();
  });
});

describe("a correction or a withdrawal whose entry was replaced since", () => {
  it("says it cannot be approved, and why, at the top, offers Discard only (UAT F-3), and the approval refuses it with the reason", () => {
    for (const kind of ["correction", "withdrawal"]) {
      const gone = screenOf({ kind, supersedesId: TARGET.id, ...(kind === "withdrawal" ? { withdrawalReason: "duplicate" } : {}) }, { target: { ...TARGET, status: "superseded", valid: false } });
      expect(gone.status).toBe("review");
      expect(gone.approveBlocked).toBe("The entry this replaces was corrected or withdrawn since it was written, so this cannot be approved. Discard it.");
      // Said once: at the top, not again in the section about the entry it replaces.
      expect(gone.replaces?.gone).toBeNull();
      const out = html(gone);
      expect(out).toContain('role="alert" class="hub-error hub-wrap" data-testid="approve-blocked"');
      expect(out).not.toContain('data-testid="approve-button"');
      expect(out).not.toContain('data-testid="return-button"');
      expect(out).toContain('data-testid="discard-button"');
      expect(out).not.toContain('data-testid="replaces-gone"');
    }
    // An entry whose target still stands offers Approve, with nothing blocking it.
    const standing = screenOf({ kind: "correction", supersedesId: TARGET.id });
    expect(standing.approveBlocked).toBeNull();
    expect(html(standing)).toContain('data-testid="approve-button"');
    // Once it no longer waits (discarded, say), the section says why it was never approved.
    const discarded = screenOf({ kind: "correction", supersedesId: TARGET.id, status: "discarded" }, { target: { ...TARGET, status: "superseded", valid: false } });
    expect(discarded.approveBlocked).toBeNull();
    expect(discarded.replaces?.gone).toMatch(/^The entry this replaces was corrected or withdrawn/);
    const gone = screenOf({ kind: "correction", supersedesId: TARGET.id }, { target: { ...TARGET, status: "superseded", valid: false } });
    for (const code of ["TARGET_NOT_VALID", "TARGET_SUPERSEDED", "TARGET_NOT_PUBLISHED"]) {
      expect(APPROVAL_MESSAGE_CODES).toContain(code);
      expect(gone.messages.errors[code]).toMatch(/Discard this/);
    }
  });
});

describe("an entry that replaces nothing", () => {
  it("shows no section, and keeps its title", () => {
    for (const kind of ["ack", "update"]) {
      const plain = approvalScreen({ review: reviewOf({ entry: { kind } as never }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
      expect(plain.replaces).toBeNull();
      expect(plain.title).toBe("Approve an alert");
      expect(html(plain)).not.toContain('data-testid="replaces"');
    }
  });
});

describe("the confirmation of an approved correction or withdrawal (O-06)", () => {
  const approved = (entry: Record<string, unknown>, extra: Parameters<typeof reviewOf>[0] = {}) => screenOf({ status: "approved", ...entry }, extra).published!;

  it("says a correction is out, and keeps the rows of an entry residents read", () => {
    const published = approved({ kind: "correction", supersedesId: TARGET.id });
    expect(published.title).toBe("The correction is out");
    expect(published.rows.map((row) => row.id)).toContain("valid");
  });

  it("says a withdrawal is out, with no validity row, no update to add and no promise of a live alert", () => {
    for (const closesThread of [false, true]) {
      const published = approved({ kind: "withdrawal", supersedesId: TARGET.id, withdrawalReason: "duplicate" }, closesThread ? { thread: { status: "closed" } as never } : {});
      expect(published.title).toBe("The withdrawal is out");
      expect(published.rows.map((row) => row.id)).not.toContain("valid");
      expect(published.rows[0].value).toBe('Residents now read "Withdrawn" and the reason in the place of the entry.');
      expect(published.next.lines).toEqual([]);
      expect(published.next.links.map((link) => link.id)).toEqual(["home", "sending"]);
    }
  });
});
