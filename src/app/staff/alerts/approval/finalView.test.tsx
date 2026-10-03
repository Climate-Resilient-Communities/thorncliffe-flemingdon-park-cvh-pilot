// The approval view of a final message (S05.03, O-16): the approver is told that approving it closes the alert as resolved, and that it goes to everyone who got any entry of
// the alert, on the channels they got it on, as well as to everyone in its own audience; the confirmation of an approved final says the alert is resolved and offers nothing to add.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { APPROVER, PLANS, reviewOf } from "../../../../../test/helpers/approvalReview";
import { ApprovalBody, type ApprovalActions } from "./ApprovalBody";
import { approvalScreen, type ApprovalScreen } from "./view";

const noop = async () => ({ status: "idle" as const });
const actions: ApprovalActions = { approve: noop, returnToAuthor: noop, discard: noop };

const screenOf = (entry: Record<string, unknown>, extra: Parameters<typeof reviewOf>[0] = {}): ApprovalScreen =>
  approvalScreen({ review: reviewOf({ closesThread: true, ...extra, entry: { kind: "final", ...entry } as never }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
const html = (screen: ApprovalScreen) => renderToStaticMarkup(<ApprovalBody screen={screen} actions={actions} />);

describe("the approval of a final message", () => {
  const screen = screenOf({});

  it("is titled as a final message, and says that it is the last word of the alert", () => {
    expect(screen.title).toBe("Approve a final message");
    expect(screen.lead).toContain("last word of this alert");
    expect(screen.replaces).toBeNull();
  });

  it("says it goes to everyone who got any entry of this alert, on the channels they got it on, and that approving it closes the alert as resolved", () => {
    expect(screen.closing).toEqual({
      title: "What approving does",
      reach: "This goes to everyone who got any entry of this alert, on the channels they got it on, and to everyone in the audience above.",
      closes: expect.stringContaining("closes the alert as resolved: nothing more is sent for it"),
    });
  });

  it("is drawn with both sentences as notes, before the final's own text", () => {
    const out = html(screen);
    expect(out).toContain('data-testid="closing"');
    expect(out).toMatch(/data-testid="closing-reach">This goes to everyone who got any entry of this alert, on the channels they got it on/);
    expect(out).toMatch(/data-testid="closing-closes">Approving it closes the alert as resolved/);
    expect(out.indexOf('data-testid="closing"')).toBeLessThan(out.indexOf('data-testid="english-text"'));
  });

  it("is not said for any other entry, and not for a final that is no longer waiting", () => {
    for (const kind of ["ack", "update", "correction", "withdrawal"]) {
      const other = approvalScreen({ review: reviewOf({ entry: { kind } as never }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER });
      expect(other.closing, kind).toBeNull();
    }
    expect(screenOf({}, { closesThread: false }).closing).toBeNull();
    expect(html(approvalScreen({ review: reviewOf({ entry: { kind: "update" } as never }), plans: PLANS, pricePerSegmentCents: 1.5, viewerId: APPROVER }))).not.toContain('data-testid="closing"');
  });
});

describe("the confirmation of an approved final (O-06)", () => {
  const published = screenOf({ status: "approved" }, { closesThread: false, thread: { status: "closed" } as never }).published!;

  it("says the alert is resolved, has no validity row, and offers nothing to add to a closed alert", () => {
    expect(published.title).toBe("The alert is resolved");
    expect(published.rows.map((row) => row.id)).not.toContain("valid");
    expect(published.rows[0].value).toMatch(/^This alert is no longer live\./);
    expect(published.next.lines).toEqual(["The alert is closed. Nothing more can be added to it."]);
    expect(published.next.links.map((link) => link.id)).toEqual(["home"]);
  });

  it("keeps the drill's confirmation a drill's", () => {
    const drill = screenOf({ status: "approved" }, { closesThread: false, thread: { status: "closed", isDrill: true } as never }).published!;
    expect(drill.title).toBe("Practice publish: nothing was sent to residents");
    expect(drill.next.lines).toEqual([]);
  });
});
