"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { staffAction, type ActionRefusal } from "../../guard";
import { saveGroupsFromForm, savePlaceFromForm, type AudienceState } from "./editAudience";

// Choosing who an alert is for is the policy action `alert.author_wide` (S01.12, AD-4): the picker offers a whole
// neighbourhood, which only a Coordinator or an Admin may author, so the guard refuses any other role (an
// Ambassador, a Director) before the action's own code, whatever the screen showed. It is not a privileged
// action: no authenticator code is asked for beyond the sign-in's. The use case then judges the rest in its
// own transaction, from rows it reads under the thread's lock: that the draft is still a draft, the places exist,
// and the author's authority for these buildings and this kind of alert (heat, smoke and winter storm are for a
// neighbourhood only), which is also asked again at submit and at approval.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.audience.errors.forbidden",
  bad_request: "staff.audience.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.audience.errors.forbidden",
};

const refused = (error: ActionRefusal): AudienceState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const deps = { alerting };

/** A saved choice goes on to the next page, which shows what was done; a refusal stays in the form. */
const finish = (state: AudienceState): AudienceState => {
  if (state.status === "saved") redirect(state.location);
  return state;
};

/** "Save the place" of the place picker (O-03). Called directly or from the form; the guard resolves the session on the server either way. */
export const savePlaceAction = staffAction(
  { route: "/staff/alerts/audience", access: "hub", action: "alert.author_wide" },
  async (session, _previous: AudienceState, form: FormData) => finish(await savePlaceFromForm(deps, session, form)),
  (error) => refused(error),
);

/** "Save the groups" of the group picker (O-04). */
export const saveGroupsAction = staffAction(
  { route: "/staff/alerts/audience/groups", access: "hub", action: "alert.author_wide" },
  async (session, _previous: AudienceState, form: FormData) => finish(await saveGroupsFromForm(deps, session, form)),
  (error) => refused(error),
);
