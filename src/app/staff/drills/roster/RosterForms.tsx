"use client";

import { useActionState } from "react";
import { addDrillPhoneAction, editDrillPhoneAction, removeDrillPhoneAction } from "./actions";
import type { RosterState } from "./control";
import { RosterFormsView, latestAnswer, type LanguageOption, type RosterLabels, type RosterRow } from "./RosterFormsView";

const IDLE: RosterState = { status: "idle" };

/**
 * The list and forms of the drill roster page (S06.05), wired to the three server actions. All are plain form actions, so they work before any script has run. The
 * page re-renders when an action finishes (the roster is read again); this component stays mounted, so the answer of the press that made the change is still on the screen.
 */
export function RosterForms({ rows, languages, labels }: { rows: readonly RosterRow[]; languages: readonly LanguageOption[]; labels: RosterLabels }) {
  const [addState, add, adding] = useActionState(addDrillPhoneAction, IDLE);
  const [editState, edit, editing] = useActionState(editDrillPhoneAction, IDLE);
  const [removeState, remove, removing] = useActionState(removeDrillPhoneAction, IDLE);
  return (
    <RosterFormsView
      rows={rows}
      languages={languages}
      labels={labels}
      answer={latestAnswer(addState, editState, removeState)}
      busy={adding || editing || removing}
      addAction={add}
      editAction={edit}
      removeAction={remove}
    />
  );
}
