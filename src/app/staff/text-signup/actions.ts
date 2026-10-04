"use server";

import { englishText } from "@/i18n/text";
import { stdoutMessagingLog } from "@/modules/messaging";
import { signupService, startSending } from "../../signup";
import { staffAction, type ActionRefusal } from "../guard";
import { signupFromForm, type ControlDeps, type SignupAnswer, type SignupState } from "./control";
import { TEXT_SIGNUP_PAGE } from "./view";

// Starting a resident's sign-up is the policy action `signup.assist` (S07.03: Ambassadors, Coordinators and Admins; not a Director). It is not
// privileged (it changes nothing a staff member can see, and is limited per staff account), so it needs no authenticator code. The guard refuses
// any other role before the action's own code; called directly, the refusal is the action's own answer, audited as `permission.denied`.
const SPEC = { route: TEXT_SIGNUP_PAGE, access: "hub", action: "signup.assist" } as const;

const deps: ControlDeps = {
  signup: signupService,
  afterAccepted: startSending,
  logError: (event, fields) => stdoutMessagingLog.error(event, { module: "subscriptions", ...fields }),
};

// This action declares no `context` and is not privileged, so `bad_request` and `aal2_required` cannot arise; they read as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.textSignup.errors.forbidden",
  bad_request: "staff.textSignup.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.textSignup.errors.forbidden",
};

const answered = (answer: SignupAnswer): SignupState => ({ ...answer, at: Date.now() });

/** "Send the confirmation text" (the form action's previous state and form data). */
export const assistedSignupAction = staffAction<[SignupState, FormData], SignupState>(
  SPEC,
  async (session, _previous, form) => answered(await signupFromForm(deps, session, form)),
  (error) => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) }),
);
