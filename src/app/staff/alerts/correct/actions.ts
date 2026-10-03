"use server";

import { redirect } from "next/navigation";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { staffAction, type ActionRefusal } from "../../guard";
import type { ComposeState } from "../composer/editDraft";
import { startCorrectionFromForm, startWithdrawalFromForm } from "../composer/startReplace";

// Starting a correction or a withdrawal (O-15, S05.02) is the policy action `alert.correct` or `alert.withdraw` (S01.12, AD-4): a Coordinator or an Admin, at
// `aal2` (both are privileged actions, so the guard also refuses a session below it before the action's own code). An Ambassador corrects or withdraws only their
// own pending entries (E08): the entry a request names is not read here, so the guard judges on a stand-in nobody wrote in this call, which refuses an Ambassador on the
// role's rule alone; and a Director is refused on their role. The use cases then judge the target and the role again in their own transaction, under the thread's lock.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.compose.errors.replaceForbidden",
  bad_request: "staff.compose.errors.replaceForbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.compose.errors.replaceAal2",
};

const refused = (error: ActionRefusal): ComposeState => ({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

const deps = { alerting, now: () => new Date() };

/** The entry the guard judges on: one nobody in this call wrote (see above). */
const NOT_THEIRS = { authorId: "00000000-0000-0000-0000-000000000000", editorIds: [], status: "pending_approval" };

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the guard's `context` takes the action's arguments; the stand-in entry needs none of them
const context = async (_session: unknown, _previous: ComposeState, _form: FormData) => ({ entry: NOT_THEIRS });

/** A draft that was made goes on to its composer; a refusal stays in the form. */
const finish = (state: ComposeState): ComposeState => {
  if (state.status === "started") redirect(state.location);
  return state;
};

/**
 * "Save draft" on a new correction (O-15 "Correct"): makes the correction's draft from the corrected words, the phase and the valid-until, for the entry it names,
 * and goes on to its composer, where it is submitted for a second person's approval.
 */
export const startCorrectionAction = staffAction(
  { route: "/staff/alerts/correct", access: "hub", action: "alert.correct", context },
  async (session, _facts, _previous: ComposeState, form: FormData) => finish(await startCorrectionFromForm(deps, session, form)),
  (error) => refused(error),
);

/** "Save draft" on a new withdrawal (O-15 "Withdraw"): the reason from the catalog and the words for residents, for the entry it names. */
export const startWithdrawalAction = staffAction(
  { route: "/staff/alerts/withdraw", access: "hub", action: "alert.withdraw", context },
  async (session, _facts, _previous: ComposeState, form: FormData) => finish(await startWithdrawalFromForm(deps, session, form)),
  (error) => refused(error),
);
