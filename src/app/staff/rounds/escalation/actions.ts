"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { escalationHandling } from "../../../escalations";
import { staffAction, type ActionRefusal } from "../../guard";
import { ESCALATION_PAGE, ROUNDS_PAGE } from "../view";
import { handleFromForm, type HandleDeps, type HandleState } from "./control";

// "Mark handled" is the policy action `checkins.follow_up` (AD-4: Admins only), which is also privileged (S01.10): the guard refuses any other role, then a
// session below aal2, before the action's own code, whatever the screen showed. Called directly, the refusal is the action's own answer, audited as a
// `permission.denied` record with status 403 (S01.12's permission list).
const SPEC = { route: ESCALATION_PAGE, access: "hub", action: "checkins.follow_up" } as const;

const deps: HandleDeps = { handling: () => escalationHandling(), logError: (event, fields) => stdoutMessagingLog.error(event, { module: "checkins", ...fields }) };

// This action declares no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.rounds.escalation.errors.forbidden",
  bad_request: "staff.rounds.escalation.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.rounds.escalation.errors.aal2Required",
};

/** "Mark handled": the escalation's id (a hidden field) and the Admin's note (the form action's previous state and form data). */
export const markHandledAction = staffAction<[HandleState, FormData], HandleState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await handleFromForm(deps, session, form);
    revalidatePath(ESCALATION_PAGE);
    revalidatePath(ROUNDS_PAGE);
    return { ...answer, at: Date.now() };
  },
  (error) => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]), at: Date.now() }),
);
