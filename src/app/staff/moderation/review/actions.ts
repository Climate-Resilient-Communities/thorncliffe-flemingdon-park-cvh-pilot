"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { acceptSubmission, declineSubmission } from "@/modules/directory";
import { directoryDb } from "../../directory";
import { staffAction, type ActionRefusal } from "../../guard";
import { MODERATION_PAGE, REVIEW_PAGE } from "../view";
import { acceptFromForm, declineFromForm, type DecideDeps, type DecideState } from "./decide";

// O-09 "Accept" and O-10 "Send the reason and decline" are the policy action `moderation.review` (a Coordinator or an Admin; a Director reads the
// queue but decides nothing): the guard refuses any other role before the action's own code, whatever the screen showed, audited as a
// `permission.denied` record. Not privileged (no aal2 step-up): a decision changes no listing (see policy.ts).
const SPEC = { route: REVIEW_PAGE, access: "hub", action: "moderation.review" } as const;

const deps: DecideDeps = {
  accept: (staffId, id) => acceptSubmission(directoryDb(), staffId, id),
  decline: (staffId, id, reason, note) => declineSubmission(directoryDb(), staffId, id, reason, note),
};

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden. `moderation.review` is not privileged, so
// `aal2_required` cannot arise either.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.moderation.errors.forbidden",
  bad_request: "staff.moderation.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.moderation.errors.forbidden",
};

const refused = (error: ActionRefusal): DecideState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** After a decision, the queue and the review are read again, so both show it. */
function decided(state: DecideState): DecideState {
  if (state.status === "done") {
    revalidatePath(MODERATION_PAGE);
    revalidatePath(REVIEW_PAGE);
  }
  return state;
}

/** "Accept" on a suggestion's review page: its id (a hidden field). */
export const acceptSubmissionAction = staffAction<[DecideState, FormData], DecideState>(
  SPEC,
  async (session, _previous, form) => decided(await acceptFromForm(deps, session, form)),
  refused,
);

/** "Send the reason and decline": its id, one pre-written reason and the Hub's optional note. */
export const declineSubmissionAction = staffAction<[DecideState, FormData], DecideState>(
  SPEC,
  async (session, _previous, form) => decided(await declineFromForm(deps, session, form)),
  refused,
);
