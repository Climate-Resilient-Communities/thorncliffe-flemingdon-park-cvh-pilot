"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { logSpendError, spendCap } from "../spendSeam";
import { setCapFromForm, type CapAnswer, type CapState, type ControlDeps } from "./control";
import { SPEND_PAGE } from "./view";

// Setting the monthly cap is the policy action `spend.cap` (AD-4: Admins only), which is also privileged (S01.10): the guard refuses any other role (a
// Director sees the spend read-only), then a session below aal2, before the action's own code, whatever the screen showed. Called directly the refusal is
// the action's own answer, audited as a `permission.denied` record with status 403 (S01.12's permission list).
const SPEC = { route: SPEND_PAGE, access: "hub", action: "spend.cap" } as const;

const deps: ControlDeps = { cap: spendCap, logError: logSpendError };

// This action declares no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.spend.errors.forbiddenCap",
  bad_request: "staff.spend.errors.forbiddenCap",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.spend.errors.aal2Required",
};

const answered = (answer: CapAnswer): CapState => ({ ...answer, at: Date.now() });
const refused = (error: ActionRefusal): CapState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Save cap", with the amount from the form (the form action's previous state and form data). */
export const setCapAction = staffAction<[CapState, FormData], CapState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await setCapFromForm(deps, session, form);
    // The page and the approval view read the cap again.
    revalidatePath(SPEND_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
