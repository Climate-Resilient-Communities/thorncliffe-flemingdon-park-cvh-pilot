import { describe, expect, it } from "vitest";
import { reviewOf } from "../../../../../test/helpers/approvalReview";
import type { ApprovalState } from "./approveFromForm";
import { confirmedCount } from "./countConfirmation";
import { countChangedView } from "./view";

const review = reviewOf({ recipients: { open: true, total: 5, byLanguage: { en: 3, ur: 2 } } });
const reviewed = { total: 5, byLanguage: { en: 3, ur: 2 } };
const changedTo = (total: number): ApprovalState => ({
  status: "count_changed",
  view: countChangedView({ review, snapshot: { total, byLanguage: { en: 3, ur: total - 3 } }, reviewed, pricePerSegmentCents: 1.5 }),
});

describe("the confirmation of a number that changed", () => {
  it("is not given until the box is ticked for the answer on screen, and is given once it is", () => {
    const first = changedTo(7);
    expect(confirmedCount(null, first)).toBe(false);
    expect(confirmedCount(first, first)).toBe(true);
  });

  it("starts again when the number changes a second time, even though the box was ticked for the first answer, and is given again once ticked for the new one", () => {
    const first = changedTo(7);
    const second = changedTo(9);
    // The approver ticked the box for 7; pressing Approve found 9: the answer on screen is the new one.
    expect(confirmedCount(first, second)).toBe(false);
    expect(confirmedCount(second, second)).toBe(true);
    // Back to the first number later (a third answer that happens to say the same as the first): still a new answer, still unconfirmed.
    const third = changedTo(7);
    expect(confirmedCount(second, third)).toBe(false);
    expect(confirmedCount(first, third)).toBe(false);
  });

  it("is taken back by unticking, and means nothing for an answer that is not a changed number", () => {
    const answer = changedTo(7);
    expect(confirmedCount(null, answer)).toBe(false);
    const refused: ApprovalState = { status: "refused", message: "This alert changed. Review it again." };
    expect(confirmedCount(refused, refused)).toBe(false);
    expect(confirmedCount(answer, { status: "idle" })).toBe(false);
  });
});
