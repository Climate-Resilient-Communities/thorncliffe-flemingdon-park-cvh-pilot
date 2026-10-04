"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { getEnv } from "@/platform/config/env";
import { alerting } from "../../alerts";
import { staffAction, type ActionRefusal } from "../../guard";
import { draftRefOf } from "../audience/editAudience";
import { expireFeed } from "../afterWebChange";
import { afterApproval } from "./afterApproval";
import { approvalRefusalMessage, approveFromForm, discardFromForm, returnFromForm, type ApprovalDeps, type ApprovalState } from "./approveFromForm";
import { approvalFacts } from "./entryFacts";

// Approving, returning and discarding are the policy action `alert.approve` (S01.12, AD-4): a Coordinator or an Admin who is not an editor of the
// entry (the guard reads who edited it from the database and refuses an editor), and a privileged action, so the guard also refuses a session below
// `aal2` before the action's own code. The use cases then judge everything again in their own transaction, under the thread's lock: the role and
// aal2, the author's current standing, the version and hash that were shown, the valid-until, and the people the text reaches.
const refused = (error: ActionRefusal): ApprovalState => ({
  status: "refused",
  message:
    error === "setup_incomplete"
      ? englishText("staff.setup.incomplete")
      : error === "aal2_required"
        ? approvalRefusalMessage("AAL2_REQUIRED")
        : error === "bad_request"
          ? approvalRefusalMessage("invalid")
          : approvalRefusalMessage("forbidden"),
});

const deps: ApprovalDeps = {
  alerting,
  afterApproval,
  afterDiscard: () => expireFeed(),
  pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
};

const SPEC = { route: "/staff/alerts/approve", access: "hub", action: "alert.approve" } as const;
const context = async (_session: unknown, _previous: ApprovalState, form: FormData) => approvalFacts(alerting(), draftRefOf(form));

/** A finished action goes back to the page, which shows what became of the entry; a refusal stays in the form. */
const finish = (state: ApprovalState): ApprovalState => {
  if (state.status === "done") redirect(state.location);
  return state;
};

/** "Approve": exactly the version, hash and number of people that were shown. */
export const approveAction = staffAction(
  { ...SPEC, context },
  async (session, _facts, _previous: ApprovalState, form: FormData) => finish(await approveFromForm(deps, session, form)),
  (error) => refused(error),
);

/** "Return to author" with a note. */
export const returnAction = staffAction(
  { ...SPEC, context },
  async (session, _facts, _previous: ApprovalState, form: FormData) => finish(await returnFromForm(deps, session, form)),
  (error) => refused(error),
);

/** "Discard". */
export const discardAction = staffAction(
  { ...SPEC, context },
  async (session, _facts, _previous: ApprovalState, form: FormData) => finish(await discardFromForm(deps, session, form)),
  (error) => refused(error),
);
