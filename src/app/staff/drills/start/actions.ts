"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { logDisruptionFromForm, type LogDeps, type LogState } from "../../alerts/log/logDisruption";
import { staffAction, type ActionRefusal } from "../../guard";
import { buildings } from "../../places";
import { DRILL_START_PAGE } from "../view";

// "Start a drill" is the policy action `drill.run` (AD-4: Admins only), which is also privileged (S01.10): the guard refuses any other role, then a session below
// aal2, before the action's own code, whatever the screen showed. The use case then judges the same two things again in its own transaction (it is the one place
// a thread can become a drill), and the thread's `is_drill` is set once and never changes. Called directly the refusal is the action's own answer, audited as a
// `permission.denied` record (S01.12's permission list).
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.log.drillForbidden",
  bad_request: "staff.log.drillForbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.log.drillAal2Required",
};

const refused = (error: ActionRefusal): LogState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const deps: LogDeps = { alerting, plans: () => buildings().listFloorPlans(), now: () => new Date(), isDrill: true };

/** A drill that was started goes on to its acknowledgement composer, marked as an exercise; a refusal, or a question about the clock change, stays in the form. */
const finish = (state: LogState): LogState => {
  if (state.status === "logged") redirect(state.location);
  return state;
};

/** "Continue" of "Start a drill": the same form as "Log a disruption" (the types, the place and the time of the first report), and a thread whose `is_drill` is true. */
export const startDrillAction = staffAction(
  { route: DRILL_START_PAGE, access: "hub", action: "drill.run" },
  async (session, _previous: LogState, form: FormData) => finish(await logDisruptionFromForm(deps, session, form)),
  (error) => refused(error),
);
