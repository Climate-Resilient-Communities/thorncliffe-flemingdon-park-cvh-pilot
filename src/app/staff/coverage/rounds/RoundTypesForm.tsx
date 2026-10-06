"use client";

import { useActionState } from "react";
import { Inline, Stack } from "@/ui";
import { CONFIRM_FIELD, type RoundTypesFormView, type RoundTypesState } from "./roundTypes";

/** The round types form's server action (actions.ts#setRoundTypesAction): the form's last state and its data in, the new state out. */
export type RoundTypesAction = (previous: RoundTypesState, form: FormData) => Promise<RoundTypesState>;

const IDLE: RoundTypesState = { status: "idle" };
const HINT_ID = "round-types-hint";
const ERROR_ID = "round-types-error";
const WARNING_ID = "round-types-resident-texts";

/**
 * "Types that start a round" (S08.06): every type of disruption as a box, ticked when its approved alerts start a check-in round now, the note that
 * the residents' texts name heat and power with the box that confirms leaving one unticked, and "Save round types". A plain form action, so it works before any script has run. The page is read again when the action finishes (the boxes then show what was
 * saved); this component stays mounted, so the answer of the press is still on the screen. The answer region is always in the page (a live region must
 * exist before its text does); a refusal is a separate alert in the Hub's error style and says that nothing changed.
 */
export function RoundTypesForm({ view, action, initialState = IDLE }: { view: RoundTypesFormView; action: RoundTypesAction; initialState?: RoundTypesState }) {
  const [state, formAction, saving] = useActionState(action, initialState);
  const refused = state.status === "refused";
  return (
    <Stack gap="stack" testId="round-types-controls">
      <div aria-live="polite" data-testid="round-types-answer">
        {state.status === "done" ? <p>{state.line}</p> : null}
      </div>
      {refused ? (
        <p id={ERROR_ID} role="alert" className="hub-error" data-testid="round-types-error">
          {state.message}
        </p>
      ) : null}
      <form action={formAction} className="hub-form">
        <Stack gap="stack">
          <fieldset aria-describedby={refused ? `${HINT_ID} ${WARNING_ID} ${ERROR_ID}` : `${HINT_ID} ${WARNING_ID}`}>
            <Stack gap="target">
              <legend>{view.legend}</legend>
              <Inline gap="target" wrap>
                {view.choices.map((choice) => (
                  <label key={choice.id} className="hub-choice">
                    <input type="checkbox" name="type" value={choice.id} defaultChecked={choice.checked} disabled={saving} />
                    <span>{choice.label}</span>
                  </label>
                ))}
              </Inline>
              <small id={HINT_ID}>{view.hint}</small>
            </Stack>
          </fieldset>
          <p id={WARNING_ID} role="note" className="hub-flag" data-testid="round-types-resident-texts">
            {view.residentTexts}
          </p>
          <label className="hub-choice">
            <input type="checkbox" name={CONFIRM_FIELD} value="yes" disabled={saving} data-testid="round-types-confirm" />
            <span>{view.confirm}</span>
          </label>
          <div>
            <button className="hub-button hub-button--primary" type="submit" disabled={saving}>
              {saving ? view.saving : view.save}
            </button>
          </div>
        </Stack>
      </form>
    </Stack>
  );
}
