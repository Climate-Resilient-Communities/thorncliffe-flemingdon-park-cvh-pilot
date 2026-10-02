"use client";

import { useActionState } from "react";
import { Inline, Stack } from "@/ui";
import type { AssignState } from "./editAssignments";
import type { AssignFormView, AssignmentRowView } from "./view";

/** An assignment form's server action (actions.ts): the form's last state and its data in, the new state out. */
export type AssignAction = (previous: AssignState, form: FormData) => Promise<AssignState>;

const IDLE: AssignState = { status: "idle" };

function Refusal({ id, state }: { id: string; state: AssignState }) {
  if (state.status !== "refused") return null;
  return (
    <p id={id} role="alert" className="hub-error">
      {state.message}
    </p>
  );
}

/** "Remove" beside one assignment: the person stays an ambassador, they stop covering the building. */
export function RemoveAssignmentForm({ rsn, row, action, initialState = IDLE }: { rsn: string; row: AssignmentRowView; action: AssignAction; initialState?: AssignState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorId = `remove-error-${row.staffId}`;
  return (
    <form action={formAction}>
      <Stack gap="label">
        <input type="hidden" name="rsn" value={rsn} />
        <input type="hidden" name="staffId" value={row.staffId} />
        <button className="hub-button hub-button--secondary" type="submit" disabled={pending} aria-label={row.removeName} aria-describedby={state.status === "refused" ? errorId : undefined}>
          {row.remove}
        </button>
        <Refusal id={errorId} state={state} />
      </Stack>
    </form>
  );
}

/**
 * "Assign an ambassador": who, then every floor or some. The floors are chosen by ticking them, or as a
 * range from one floor to another (the building's own order); both can be used together.
 */
export function AssignForm({ rsn, labels, action, initialState = IDLE }: { rsn: string; labels: AssignFormView; action: AssignAction; initialState?: AssignState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorId = "assign-error";
  const refused = state.status === "refused";
  if (labels.noAmbassadors) {
    return (
      <section aria-labelledby="assign-title">
        <Stack gap="related">
          <h2 id="assign-title">{labels.title}</h2>
          <p>{labels.noAmbassadors}</p>
        </Stack>
      </section>
    );
  }
  return (
    <section aria-labelledby="assign-title">
      <Stack gap="related">
        <h2 id="assign-title">{labels.title}</h2>
        <form action={formAction}>
          <Stack gap="stack">
            <input type="hidden" name="rsn" value={rsn} />
            <Refusal id={errorId} state={state} />
            <Stack gap="label">
              <label htmlFor="assign-person">{labels.person}</label>
              <select className="hub-input" id="assign-person" name="staffId" defaultValue="" aria-describedby={refused ? errorId : undefined} aria-invalid={refused || undefined}>
                <option value="">{labels.choose}</option>
                {labels.ambassadors.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </Stack>
            <fieldset>
              <Stack gap="label">
                <legend>{labels.scope}</legend>
                <label>
                  <input type="radio" name="scope" value="all" defaultChecked /> {labels.all}
                </label>
                <label>
                  <input type="radio" name="scope" value="some" disabled={labels.floors.length === 0} /> {labels.some}
                </label>
                {labels.noFloors && <p>{labels.noFloors}</p>}
              </Stack>
            </fieldset>
            {labels.floors.length > 0 && (
              <>
                <fieldset>
                  <Stack gap="label">
                    <legend>{labels.pick}</legend>
                    <Inline gap="related" wrap>
                      {labels.floors.map((floor) => (
                        <label key={floor.id}>
                          <input type="checkbox" name="floorId" value={floor.id} /> {floor.label}
                        </label>
                      ))}
                    </Inline>
                  </Stack>
                </fieldset>
                <fieldset>
                  <Stack gap="label">
                    <legend>{labels.range}</legend>
                    <Inline gap="related" align="center" wrap>
                      <label htmlFor="assign-from">{labels.from}</label>
                      <select className="hub-input" id="assign-from" name="from" defaultValue="">
                        <option value="">{labels.none}</option>
                        {labels.floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.label}
                          </option>
                        ))}
                      </select>
                      <label htmlFor="assign-to">{labels.to}</label>
                      <select className="hub-input" id="assign-to" name="to" defaultValue="">
                        <option value="">{labels.none}</option>
                        {labels.floors.map((floor) => (
                          <option key={floor.id} value={floor.id}>
                            {floor.label}
                          </option>
                        ))}
                      </select>
                    </Inline>
                  </Stack>
                </fieldset>
              </>
            )}
            <button className="hub-button hub-button--primary" type="submit" disabled={pending}>
              {labels.submit}
            </button>
          </Stack>
        </form>
      </Stack>
    </section>
  );
}
