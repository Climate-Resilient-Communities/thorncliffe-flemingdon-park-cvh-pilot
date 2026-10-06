"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { oncallRoster } from "../../oncall";
import { staffAction, type ActionRefusal } from "../guard";
import { addFromForm, clearOnDutyFromForm, removeFromForm, setOnDutyFromForm, type ControlDeps, type OncallAnswer, type OncallState } from "./control";
import { ONCALL_PAGE } from "./view";

// Adding and removing an on-call number, and (S08.08) setting or ending the on-duty entry, is the policy action `oncall.manage` (AD-4: Admins only),
// which is also privileged (S01.10): the guard refuses any other role, then a session below aal2, before the action's own code, whatever the screen
// showed. Called directly, the refusal is the action's own answer, audited as a `permission.denied` record with status 403 (S01.12's permission list).
const SPEC = { route: ONCALL_PAGE, access: "hub", action: "oncall.manage" } as const;

const deps: ControlDeps = { roster: oncallRoster, logError: (event, fields) => stdoutMessagingLog.error(event, { module: "ops", ...fields }) };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.oncall.errors.forbidden",
  bad_request: "staff.oncall.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.oncall.errors.aal2Required",
};

const answered = (answer: OncallAnswer): OncallState => ({ ...answer, at: Date.now() });
const refused = (error: ActionRefusal): OncallState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Add number": the label and the number from the form (the form action's previous state and form data). */
export const addOncallAction = staffAction<[OncallState, FormData], OncallState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await addFromForm(deps, session, form);
    revalidatePath(ONCALL_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** S08.08, "Set on duty": the roster entry and the Admin account chosen (the same two arguments). The same policy action, Admins at aal2. */
export const setOnDutyAction = staffAction<[OncallState, FormData], OncallState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await setOnDutyFromForm(deps, session, form);
    revalidatePath(ONCALL_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** S08.08, "Nobody on duty". */
export const clearOnDutyAction = staffAction<[OncallState, FormData], OncallState>(
  SPEC,
  async (session) => {
    const answer = await clearOnDutyFromForm(deps, session);
    revalidatePath(ONCALL_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Remove" beside one number (the same two arguments; the id is a hidden field). */
export const removeOncallAction = staffAction<[OncallState, FormData], OncallState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await removeFromForm(deps, session, form);
    revalidatePath(ONCALL_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
