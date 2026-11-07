"use client";

import { useActionState } from "react";
import { acceptSubmissionAction, declineSubmissionAction } from "./actions";
import type { DecideState } from "./decide";
import { DecideView, type DecideLabels, type DecideReason } from "./DecideView";

const IDLE: DecideState = { status: "idle" };

/**
 * O-09's Accept and O-10's decline wired to their server actions. Plain form actions, so they work before any script has run. The page renders
 * again when one finishes (the suggestion is read again and shows its decision); this component stays mounted, so the answer of the press, with
 * the way to the next suggestion, is still on the screen.
 */
export function DecideForms(props: {
  id: string;
  waiting: boolean;
  declining: boolean;
  reasons: readonly DecideReason[];
  labels: DecideLabels;
  hrefs: { decline: string; review: string; queue: string; next: { href: string; label: string } | null };
}) {
  const [accepted, accept, accepting] = useActionState(acceptSubmissionAction, IDLE);
  const [declined, decline, declining] = useActionState(declineSubmissionAction, IDLE);
  // The latest press's answer: a decline form is shown only after the page moved to `?decline=1`, so at most one of the two has spoken.
  const answer = declined.status !== "idle" ? declined : accepted;
  return <DecideView {...props} answer={answer} pending={accepting ? "accept" : declining ? "decline" : null} accept={accept} decline={decline} />;
}
