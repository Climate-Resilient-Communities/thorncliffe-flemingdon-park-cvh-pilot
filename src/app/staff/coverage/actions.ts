"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { assignments } from "../assignments";
import { staffAction, type ActionRefusal } from "../guard";
import { assignFromForm, removeFromForm, type AssignState } from "./editAssignments";

// Assigning and removing are the policy action `accounts.manage` (AD-4: an assignment is part of a staff
// account, Admin only), which is also privileged (S01.10): the guard refuses any other role, then a session
// below aal2, before the action's own code, whatever the screen showed. Each declares the building it is on
// as its `context`, read from the form once and judged; the action then acts on that building and does not
// read it again. The building is only named here: whether it exists is the use case's refusal (audited), so
// a form without one is refused there and nothing changes. (An Admin's rule needs no more than the role.)
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.coverage.errors.assignForbidden",
  bad_request: "staff.coverage.errors.assignForbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.coverage.errors.aal2Required",
};

const refused = (error: ActionRefusal): AssignState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const SPEC = { route: "/staff/coverage", access: "hub", action: "accounts.manage" } as const;

/** The building a form is on, as it names it; an empty or malformed one is refused as "no such building" by the use case. */
function buildingOf(form: FormData): { rsn: string } {
  const rsn = form.get("rsn");
  return { rsn: typeof rsn === "string" ? rsn : "" };
}

/** A saved change goes back to the building's page, which shows what was done; a refusal stays in the form. */
const finish = (state: AssignState): AssignState => {
  if (state.status === "saved") redirect(state.location);
  return state;
};

/** "Assign" an ambassador to the building's floors. Called directly or from the form; the guard resolves the session on the server either way. */
export const assignAmbassadorAction = staffAction(
  { ...SPEC, context: async (_session, _previous: AssignState, form: FormData) => ({ target: buildingOf(form) }) },
  async (session, facts, _previous: AssignState, form: FormData) =>
    facts.target ? finish(await assignFromForm({ assignments }, session, facts.target.rsn, form)) : refused("bad_request"),
  (error) => refused(error),
);

/** "Remove" an ambassador's assignment to the building. */
export const removeAssignmentAction = staffAction(
  { ...SPEC, context: async (_session, _previous: AssignState, form: FormData) => ({ target: buildingOf(form) }) },
  async (session, facts, _previous: AssignState, form: FormData) =>
    facts.target ? finish(await removeFromForm({ assignments }, session, facts.target.rsn, form)) : refused("bad_request"),
  (error) => refused(error),
);
