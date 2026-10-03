import type { ApprovalState } from "./approveFromForm";

/**
 * Whether the approver has confirmed the number of people the answer on the screen names (S04.07). The tick belongs to the answer it was given
 * for (`ticked`: the answer on screen when the box was ticked, or null): an answer that says the number changed again is a new answer, so the
 * box starts unticked and Approve waits for a fresh confirmation, whatever was ticked for the answer before. Anything but a count that changed
 * has nothing to confirm.
 */
export const confirmedCount = (ticked: ApprovalState | null, answer: ApprovalState): boolean => answer.status === "count_changed" && ticked === answer;
