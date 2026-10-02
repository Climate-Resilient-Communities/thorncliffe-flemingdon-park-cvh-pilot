"use server";

import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { identity, staffAuth } from "../identity";
import { addPersonFromForm, addPersonValues, type AddPersonState } from "./addPerson";
import { reissueFromForm, reissueUsername, type ReissueState } from "./reissue";
import { resetAuthenticatorFromForm, resetAuthenticatorUsername, type ResetAuthenticatorState } from "./resetAuthenticator";
import { resetPasswordFromForm, resetUsername, type ResetPasswordState } from "./resetPassword";

// Without a session the guard sends the person to sign-in; another setup gate, a role the policy
// refuses (S01.12: accounts are Admin-only) and a session below aal2 answer here.
const REFUSAL_KEYS: Record<Exclude<ActionRefusal, "forbidden">, string> = {
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.authenticator.required",
};

const refusalMessage = (error: ActionRefusal, forbiddenKey: string) => englishText(error === "forbidden" ? forbiddenKey : REFUSAL_KEYS[error]);

// Every account change is the policy action `accounts.manage` (AD-4: Admins only), which is also
// privileged (S01.10): the guard refuses any other role, then a session below aal2, before the
// action's own code, whatever the screen showed.

/** "Add a person" (S01.05). Called directly or from the form; the guard resolves the session on the server either way. */
export const addPersonAction = staffAction(
  { route: "/staff/people", access: "hub", action: "accounts.manage" },
  async (session, _previous: AddPersonState, form: FormData): Promise<AddPersonState> => addPersonFromForm({ identity }, session, form),
  (error, _previous, form): AddPersonState => ({ status: "refused", message: refusalMessage(error, "staff.people.errors.forbidden"), values: addPersonValues(form) }),
);

/** "Re-issue a starting password" (S01.07), on the same page. */
export const reissueAction = staffAction(
  { route: "/staff/people", access: "hub", action: "accounts.manage" },
  async (session, _previous: ReissueState, form: FormData): Promise<ReissueState> => reissueFromForm({ staffAuth }, session, form),
  (error, _previous, form): ReissueState => ({ status: "refused", message: refusalMessage(error, "staff.reissue.errors.forbidden"), username: reissueUsername(form) }),
);

/** "Reset password" (S01.08), on the same page. */
export const resetPasswordAction = staffAction(
  { route: "/staff/people", access: "hub", action: "accounts.manage" },
  async (session, _previous: ResetPasswordState, form: FormData): Promise<ResetPasswordState> => resetPasswordFromForm({ identity }, session, form),
  (error, _previous, form): ResetPasswordState => ({ status: "refused", message: refusalMessage(error, "staff.resetPassword.errors.forbidden"), username: resetUsername(form) }),
);

/** "Reset authenticator" (S01.11), on the same page: Admin only, never on oneself, from an aal2 session. */
export const resetAuthenticatorAction = staffAction(
  { route: "/staff/people", access: "hub", action: "accounts.manage" },
  async (session, _previous: ResetAuthenticatorState, form: FormData): Promise<ResetAuthenticatorState> => resetAuthenticatorFromForm({ identity }, session, form),
  (error, _previous, form): ResetAuthenticatorState => ({ status: "refused", message: refusalMessage(error, "staff.resetAuthenticator.errors.forbidden"), username: resetAuthenticatorUsername(form) }),
);
