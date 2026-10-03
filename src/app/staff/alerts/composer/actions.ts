"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { staffAction, type ActionRefusal } from "../../guard";
import { pullBackFromForm, saveDraftFromForm, type ComposeState } from "./editDraft";

// Writing an alert is the policy action `alert.author_wide` (S01.12, AD-4), like the audience pickers and "Log a disruption": a composer
// can aim at a whole neighbourhood and use the neighbourhood-wide types, which only a Coordinator or an Admin author, so the guard
// refuses any other role before the action's own code. It is not a privileged action: no authenticator code beyond the sign-in's. The use
// cases then judge the rest in their own transactions, under the thread's lock.
// TODO(E08): an Ambassador's own screens write for the buildings they are assigned to (`alert.author`); E08 guards those actions by scope.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.compose.errors.forbidden",
  bad_request: "staff.compose.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.compose.errors.forbidden",
};

const refused = (error: ActionRefusal): ComposeState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const deps = { alerting, now: () => new Date() };

/**
 * A draft saved from the Save button, and a pulled-back entry, reload their composer, which shows what was done; a refusal stays in the
 * form. A draft saved as the first half of a submit (the location has no `saved=1`) stays where it is: the submit follows it from the browser.
 */
const finish = (state: ComposeState): ComposeState => {
  if (state.status === "pulled_back") redirect(state.location);
  if (state.status === "saved" && state.location.includes("saved=1")) redirect(state.location);
  return state;
};

/** "Save draft" of the composers (O-12, O-02). Called directly (the first half of a submit) or from the form. */
export const saveDraftAction = staffAction(
  { route: "/staff/alerts/compose", access: "hub", action: "alert.author_wide" },
  async (session, _previous: ComposeState, form: FormData) => finish(await saveDraftFromForm(deps, session, form)),
  (error) => refused(error),
);

/** "Pull back to edit" on a submitted entry: back to a draft the person can change. */
export const pullBackAction = staffAction(
  { route: "/staff/alerts/compose", access: "hub", action: "alert.author_wide" },
  async (session, _previous: ComposeState, form: FormData) => finish(await pullBackFromForm(deps, session, form)),
  (error) => refused(error),
);
