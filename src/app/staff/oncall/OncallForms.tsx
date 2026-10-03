"use client";

import { useActionState } from "react";
import { addOncallAction, removeOncallAction } from "./actions";
import type { OncallState } from "./control";
import { OncallFormsView, latestAnswer, type OncallLabels, type OncallRow } from "./OncallFormsView";

const IDLE: OncallState = { status: "idle" };

/**
 * The list and forms of the on-call numbers page (S06.07), wired to the two server actions. Both are plain form actions, so they work before
 * any script has run. The page re-renders when an action finishes (the roster is read again); this component stays mounted, so the answer
 * of the press that made the change is still on the screen.
 */
export function OncallForms({ rows, labels }: { rows: readonly OncallRow[]; labels: OncallLabels }) {
  const [addState, add, adding] = useActionState(addOncallAction, IDLE);
  const [removeState, remove, removing] = useActionState(removeOncallAction, IDLE);
  return (
    <OncallFormsView
      rows={rows}
      labels={labels}
      answer={latestAnswer(addState, removeState)}
      adding={adding}
      removing={removing}
      addAction={add}
      removeAction={remove}
    />
  );
}
