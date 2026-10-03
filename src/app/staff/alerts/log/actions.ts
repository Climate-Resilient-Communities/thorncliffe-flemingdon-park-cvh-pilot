"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { staffAction, type ActionRefusal } from "../../guard";
import { buildings } from "../../places";
import { logDisruptionFromForm, type LogState } from "./logDisruption";

// Logging a disruption is the policy action `alert.author_wide` (S01.12, AD-4), like the audience pickers: the place picker offers a
// whole neighbourhood, which only a Coordinator or an Admin may author, so the guard refuses any other role before the action's own code,
// whatever the screen showed. It is not a privileged action (no authenticator code beyond the sign-in's). The use case then judges the
// rest in its own transaction: the role for these types and this place, the places, the time of the first report.
// TODO(E08): an Ambassador's own screens log and post for the buildings they are assigned to (`alert.author`); E08 decides how, and
// guards that action by the scope of what it creates.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.log.forbidden",
  bad_request: "staff.log.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.log.forbidden",
};

const refused = (error: ActionRefusal): LogState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const deps = { alerting, plans: () => buildings().listFloorPlans(), now: () => new Date() };

/** A logged disruption goes on to its composer; a refusal, or a question about the clock change, stays in the form. */
const finish = (state: LogState): LogState => {
  if (state.status === "logged") redirect(state.location);
  return state;
};

/** "Continue" of "Log a disruption" (O-11) and of "Compose an alert" (O-02's first step). Called directly or from the form; the guard resolves the session on the server either way. */
export const logDisruptionAction = staffAction(
  { route: "/staff/alerts/log", access: "hub", action: "alert.author_wide" },
  async (session, _previous: LogState, form: FormData) => finish(await logDisruptionFromForm(deps, session, form)),
  (error) => refused(error),
);
