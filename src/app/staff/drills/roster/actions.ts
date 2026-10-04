"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { drillRoster } from "../../../drills";
import { staffAction, type ActionRefusal } from "../../guard";
import { DRILL_ROSTER_PAGE } from "../view";
import { addFromForm, editFromForm, removeFromForm, type ControlDeps, type RosterAnswer, type RosterState } from "./control";

// Adding, changing and removing a roster phone is the policy action `drill.run` (AD-4: Admins only), which is also privileged (S01.10): the guard refuses any other
// role, then a session below aal2, before the action's own code, whatever the screen showed. Called directly, the refusal is the action's own answer, audited as a
// `permission.denied` record with status 403 (S01.12's permission list).
const SPEC = { route: DRILL_ROSTER_PAGE, access: "hub", action: "drill.run" } as const;

const deps: ControlDeps = { roster: drillRoster, logError: (event, fields) => stdoutMessagingLog.error(event, { module: "subscriptions", ...fields }) };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.drillRoster.errors.forbidden",
  bad_request: "staff.drillRoster.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.drillRoster.errors.aal2Required",
};

const answered = (answer: RosterAnswer): RosterState => ({ ...answer, at: Date.now() });
const refused = (error: ActionRefusal): RosterState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Add phone": the label, the number and the language from the form (the form action's previous state and form data). */
export const addDrillPhoneAction = staffAction<[RosterState, FormData], RosterState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await addFromForm(deps, session, form);
    revalidatePath(DRILL_ROSTER_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Save changes" beside one phone (the same two arguments; the id is a hidden field). */
export const editDrillPhoneAction = staffAction<[RosterState, FormData], RosterState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await editFromForm(deps, session, form);
    revalidatePath(DRILL_ROSTER_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Remove" beside one phone (the same two arguments; the id is a hidden field). */
export const removeDrillPhoneAction = staffAction<[RosterState, FormData], RosterState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await removeFromForm(deps, session, form);
    revalidatePath(DRILL_ROSTER_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
