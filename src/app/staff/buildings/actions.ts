"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { buildings } from "../places";
import { addFloorFromForm, confirmFromForm, removeFloorFromForm, renameFloorFromForm, type EditState } from "./editFloors";

// Every change here is the policy action `buildings.manage` (AD-4: Admin-only reference data), which is
// also privileged (S01.10): the guard refuses any other role, then a session below aal2, before the
// action's own code, whatever the screen showed. Without a session the guard sends the person to sign-in.
// (These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.)
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.buildings.errors.forbidden",
  bad_request: "staff.buildings.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.authenticator.required",
};

const refused = (error: ActionRefusal): EditState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const SPEC = { route: "/staff/buildings", access: "hub", action: "buildings.manage" } as const;

/** A saved change goes back to the building's page, which shows what was done; a refusal stays in the form. */
const finish = (state: EditState): EditState => {
  if (state.status === "saved") redirect(state.location);
  return state;
};

/** "Add a floor". Called directly or from the form; the guard resolves the session on the server either way. */
export const addFloorAction = staffAction(
  SPEC,
  async (session, _previous: EditState, form: FormData) => finish(await addFloorFromForm({ buildings }, session, form)),
  (error) => refused(error),
);

/** "Rename" a floor. */
export const renameFloorAction = staffAction(
  SPEC,
  async (session, _previous: EditState, form: FormData) => finish(await renameFloorFromForm({ buildings }, session, form)),
  (error) => refused(error),
);

/** "Remove" a floor. */
export const removeFloorAction = staffAction(
  SPEC,
  async (session, _previous: EditState, form: FormData) => finish(await removeFloorFromForm({ buildings }, session, form)),
  (error) => refused(error),
);

/** "Mark building confirmed". */
export const confirmBuildingAction = staffAction(
  SPEC,
  async (session, _previous: EditState, form: FormData) => finish(await confirmFromForm({ buildings }, session, form)),
  (error) => refused(error),
);
