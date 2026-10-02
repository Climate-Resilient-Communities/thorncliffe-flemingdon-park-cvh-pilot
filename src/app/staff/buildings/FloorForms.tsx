"use client";

import { useActionState } from "react";
import { Inline, Stack } from "@/ui";
import type { EditState } from "./editFloors";
import type { BuildingView, FloorRowView } from "./view";

/** A floor form's server action (actions.ts): the form's last state and its data in, the new state out. */
export type FloorAction = (previous: EditState, form: FormData) => Promise<EditState>;

const IDLE: EditState = { status: "idle" };

/** A refusal, with the reason, and who blocks it when Ambassadors are assigned. */
function Refusal({ id, state }: { id: string; state: EditState }) {
  if (state.status !== "refused") return null;
  return (
    <Stack gap="subline">
      <p id={id} role="alert">
        {state.message}
      </p>
      {state.detail && <p>{state.detail}</p>}
    </Stack>
  );
}

/** One floor: its label with "Rename", and "Remove". Each has its own form, so Enter in the label renames. */
export function FloorRow({
  rsn,
  floor,
  labels,
  rename,
  remove,
  initialRename = IDLE,
  initialRemove = IDLE,
}: {
  rsn: string;
  floor: FloorRowView;
  labels: BuildingView["floors"];
  rename: FloorAction;
  remove: FloorAction;
  /** Test seams: the states to start from. */
  initialRename?: EditState;
  initialRemove?: EditState;
}) {
  const [renameState, renameForm, renaming] = useActionState(rename, initialRename);
  const [removeState, removeForm, removing] = useActionState(remove, initialRemove);
  const renameError = `rename-error-${floor.id}`;
  const removeError = `remove-error-${floor.id}`;
  const shown = renameState.status === "refused" && renameState.label !== undefined ? renameState.label : floor.label;
  return (
    <li data-testid={`floor-${floor.id}`}>
      <Stack gap="label">
        <Inline gap="related" align="center">
          {/* A new key after each refusal shows the label as it was typed; the form would otherwise reset. */}
          <form action={renameForm} key={renameState.status === "refused" ? JSON.stringify(renameState) : "rename"}>
            <Inline gap="target" align="center">
              <input type="hidden" name="rsn" value={rsn} />
              <input type="hidden" name="floorId" value={floor.id} />
              <input
                className="tap"
                type="text"
                name="label"
                defaultValue={shown}
                autoComplete="off"
                spellCheck={false}
                aria-label={floor.inputLabel}
                aria-describedby={renameState.status === "refused" ? renameError : undefined}
                aria-invalid={renameState.status === "refused" || undefined}
              />
              <button className="tap" type="submit" disabled={renaming}>
                {labels.rename}
              </button>
            </Inline>
          </form>
          <form action={removeForm}>
            <input type="hidden" name="rsn" value={rsn} />
            <input type="hidden" name="floorId" value={floor.id} />
            <button className="tap" type="submit" disabled={removing}>
              {labels.remove}
            </button>
          </form>
          {floor.note && <span>{floor.note}</span>}
        </Inline>
        <Refusal id={renameError} state={renameState} />
        <Refusal id={removeError} state={removeState} />
      </Stack>
    </li>
  );
}

/** "Add a floor": a label, and whether it goes above the top floor or below the lowest. */
export function AddFloorForm({ rsn, labels, action, initialState = IDLE }: { rsn: string; labels: BuildingView["add"]; action: FloorAction; initialState?: EditState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorId = "add-floor-error";
  const refused = state.status === "refused";
  return (
    <section aria-labelledby="add-floor-title">
      <Stack gap="related">
        <h2 id="add-floor-title">{labels.title}</h2>
        <form action={formAction} key={refused ? JSON.stringify(state) : "add"}>
          <Stack gap="stack">
            <input type="hidden" name="rsn" value={rsn} />
            <Refusal id={errorId} state={state} />
            <Stack gap="label">
              <label htmlFor="add-floor-label">{labels.label}</label>
              <p id="add-floor-hint">{labels.hint}</p>
              <input
                className="tap"
                id="add-floor-label"
                type="text"
                name="label"
                defaultValue={refused ? state.label : undefined}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={refused ? `add-floor-hint ${errorId}` : "add-floor-hint"}
                aria-invalid={refused || undefined}
              />
            </Stack>
            <Stack gap="label">
              <label htmlFor="add-floor-place">{labels.place}</label>
              <select className="tap" id="add-floor-place" name="place" defaultValue={refused ? (state.place ?? "top") : "top"}>
                <option value="top">{labels.top}</option>
                <option value="bottom">{labels.bottom}</option>
              </select>
            </Stack>
            <button className="tap" type="submit" disabled={pending}>
              {labels.submit}
            </button>
          </Stack>
        </form>
      </Stack>
    </section>
  );
}

/** "Mark building confirmed": the Admin says the floors above are the floors people can be on. */
export function ConfirmForm({ rsn, labels, action, initialState = IDLE }: { rsn: string; labels: NonNullable<BuildingView["confirm"]>; action: FloorAction; initialState?: EditState }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <section aria-labelledby="confirm-building-title">
      <Stack gap="related">
        <h2 id="confirm-building-title">{labels.title}</h2>
        <p>{labels.lead}</p>
        <form action={formAction}>
          <Stack gap="stack">
            <input type="hidden" name="rsn" value={rsn} />
            <Refusal id="confirm-error" state={state} />
            <button className="tap" type="submit" disabled={pending}>
              {labels.submit}
            </button>
          </Stack>
        </form>
      </Stack>
    </section>
  );
}
