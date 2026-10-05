"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../../../guard";
import { logResendError, resendService, startSending } from "../../../resendSeam";
import { resendAllFromForm, resendOneFromForm, type ControlDeps, type ResendAnswer, type ResendState } from "./control";

// Resending is the policy action `delivery.resend` (AD-4: Admins only), which is also privileged (S01.10): the guard refuses any other role, then a session below aal2,
// before the action's own code, whatever the screen showed. Called directly the refusal is the action's own answer, audited as a `permission.denied` record with status 403
// (S01.12's permission list).
const LIST_PAGE = "/staff/alerts/sending/texts";
const SPEC = { route: LIST_PAGE, access: "hub", action: "delivery.resend" } as const;

const deps: ControlDeps = { resend: resendService, startSending, logError: logResendError };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.sending.resend.errors.forbidden",
  bad_request: "staff.sending.resend.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.sending.resend.errors.aal2Required",
};

const answered = (answer: ResendAnswer): ResendState => ({ ...answer, at: Date.now() });
const refused = (error: ActionRefusal): ResendState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Resend" on one failed, undelivered or unknown text (the form's previous state and form data). */
export const resendTextAction = staffAction<[ResendState, FormData], ResendState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await resendOneFromForm(deps, session, form);
    // The list reads the chains again.
    revalidatePath(LIST_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Resend the failed and undelivered texts in {language}" for an entry. */
export const resendAllAction = staffAction<[ResendState, FormData], ResendState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await resendAllFromForm(deps, session, form);
    revalidatePath(LIST_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
