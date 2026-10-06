"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../../guard";
import { logPlacesError, roundTypes } from "../../places";
import { COVERAGE_PAGE } from "../view";
import { setRoundTypesFromForm, type RoundTypesAnswer, type RoundTypesDeps, type RoundTypesState } from "./roundTypes";

// S08.06: "Save round types" on the coverage page is the policy action `checkins.round_types` (E08 "Round types": Admins at aal2), which is also
// privileged: the guard refuses any other role (a Coordinator and a Director read the round types), then a session below aal2, before the action's
// own code, whatever the screen showed. Called directly, the refusal is the action's own answer, audited as a `permission.denied` record with status
// 403 (S01.12's permission list).
const SPEC = { route: COVERAGE_PAGE, access: "hub", action: "checkins.round_types" } as const;

// This action declares no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.coverage.rounds.errors.forbidden",
  bad_request: "staff.coverage.rounds.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.coverage.rounds.errors.aal2Required",
};

const deps: RoundTypesDeps = { roundTypes, logError: logPlacesError };

const answered = (answer: RoundTypesAnswer): RoundTypesState => ({ ...answer, at: Date.now() });

/** "Save round types", with the ticked types from the form (the form action's previous state and form data). */
export const setRoundTypesAction = staffAction<[RoundTypesState, FormData], RoundTypesState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await setRoundTypesFromForm(deps, session, form);
    // The page reads the round types again; the next approval reads them in its own transaction.
    revalidatePath(COVERAGE_PAGE);
    return answered(answer);
  },
  (error) => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) }),
);
