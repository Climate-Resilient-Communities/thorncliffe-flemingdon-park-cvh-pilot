"use client";

import { useActionState } from "react";
import { markHandledAction } from "./actions";
import type { HandleState } from "./control";
import { HandleFormView, type HandleLabels } from "./HandleFormView";

const IDLE: HandleState = { status: "idle" };

/**
 * "Mark handled" wired to its server action (S08.08). A plain form action, so it works before any script has run. The page renders again when it finishes
 * (the escalation is read again and shows who handled it); this component stays mounted, so the answer of the press is still on the screen.
 */
export function HandleForm({ id, open, labels }: { id: string; open: boolean; labels: HandleLabels }) {
  const [answer, mark, pending] = useActionState(markHandledAction, IDLE);
  return <HandleFormView id={id} open={open} labels={labels} answer={answer} pending={pending} action={mark} />;
}
