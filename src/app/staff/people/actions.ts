"use server";

import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { identity, staffAuth } from "../identity";
import { addPersonFromForm, addPersonValues, type AddPersonState } from "./addPerson";
import { reissueFromForm, reissueUsername, type ReissueState } from "./reissue";
import { resetPasswordFromForm, resetUsername, type ResetPasswordState } from "./resetPassword";

// Without a session the guard sends the person to sign-in; another setup gate and a session below
// aal2 answer here.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.authenticator.required",
};

const refusalMessage = (error: ActionRefusal) => englishText(REFUSAL_KEYS[error]);

// Every account change is privileged (S01.10): it runs only from an aal2 session, whatever the
// screen showed. The guard refuses it before the action's own code (requireAal2).

/** "Add a person" (S01.05). Called directly or from the form; the guard resolves the session on the server either way. */
export const addPersonAction = staffAction(
  { route: "/staff/people", access: "hub", privileged: "accounts.manage" },
  async (session, _previous: AddPersonState, form: FormData): Promise<AddPersonState> => addPersonFromForm({ identity }, session, form),
  (error, _previous, form): AddPersonState => ({ status: "refused", message: refusalMessage(error), values: addPersonValues(form) }),
);

/** "Re-issue a starting password" (S01.07), on the same page. */
export const reissueAction = staffAction(
  { route: "/staff/people", access: "hub", privileged: "accounts.manage" },
  async (session, _previous: ReissueState, form: FormData): Promise<ReissueState> => reissueFromForm({ staffAuth }, session, form),
  (error, _previous, form): ReissueState => ({ status: "refused", message: refusalMessage(error), username: reissueUsername(form) }),
);

/** "Reset password" (S01.08), on the same page. */
export const resetPasswordAction = staffAction(
  { route: "/staff/people", access: "hub", privileged: "accounts.manage" },
  async (session, _previous: ResetPasswordState, form: FormData): Promise<ResetPasswordState> => resetPasswordFromForm({ identity }, session, form),
  (error, _previous, form): ResetPasswordState => ({ status: "refused", message: refusalMessage(error), username: resetUsername(form) }),
);
