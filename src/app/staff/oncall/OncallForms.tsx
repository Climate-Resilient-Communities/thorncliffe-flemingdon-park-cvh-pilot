"use client";

import { useActionState, useState } from "react";
import { addOncallAction, clearOnDutyAction, removeOncallAction, setOnDutyAction } from "./actions";
import type { OncallState } from "./control";
import { OncallFormsView, fieldsAfter, latestAnswer, shownAnswer, type OncallLabels, type OncallRow } from "./OncallFormsView";
import type { OnDutyView } from "./view";

const IDLE: OncallState = { status: "idle" };

/**
 * The list and forms of the on-call numbers page (S06.07), wired to the server actions, with (S08.08) the on-duty choice. All are plain form actions, so
 * they work before any script has run. The page re-renders when an action finishes (the roster is read again); this component stays mounted, so the answer
 * of the press that made the change is still on the screen.
 */
export function OncallForms({ rows, labels, onDuty }: { rows: readonly OncallRow[]; labels: OncallLabels; onDuty?: OnDutyView }) {
  const [addState, add, adding] = useActionState(addOncallAction, IDLE);
  const [removeState, remove, removing] = useActionState(removeOncallAction, IDLE);
  const [setState, set, setting] = useActionState(setOnDutyAction, IDLE);
  const [clearState, clear, clearing] = useActionState(clearOnDutyAction, IDLE);
  // UAT F-1: the add form's fields live here, so a refusal leaves them as typed (React empties a form's own fields after its action) and a number added empties
  // them; a change to either takes the refusal off the screen. Page memory only: the server never sends a number back.
  const [fields, setFields] = useState({ label: "", number: "" });
  const [answeredAdd, setAnsweredAdd] = useState(addState);
  if (answeredAdd !== addState) {
    setAnsweredAdd(addState);
    setFields(fieldsAfter(addState, fields));
  }
  const answer = latestAnswer(addState, removeState, setState, clearState);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const onChange = (field: "label" | "number", value: string) => {
    setFields((current) => ({ ...current, [field]: value }));
    if (answer.status === "refused") setDismissed(answer.at);
  };
  return (
    <OncallFormsView
      rows={rows}
      labels={labels}
      answer={shownAnswer(answer, dismissed)}
      addFields={{ ...fields, onChange }}
      adding={adding}
      removing={removing}
      addAction={add}
      removeAction={remove}
      onDuty={onDuty}
      setting={setting}
      clearing={clearing}
      setOnDutyAction={set}
      clearOnDutyAction={clear}
    />
  );
}
