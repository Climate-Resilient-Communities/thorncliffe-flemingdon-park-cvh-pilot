"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { logPauseError, messagingPause, pausedByName, startSending } from "../messagingPause";
import { pauseFromForm, resumeFromForm, type ControlDeps, type TextsAnswer, type TextsState } from "./control";
import { TEXTS_PAGE } from "./view";

// "Pause all texts" and "Resume texts" are the policy action `sending.pause` (AD-4: Admins only), which is also privileged (S01.10): the
// guard refuses any other role, then a session below aal2, before the action's own code, whatever the screen showed. Called directly
// the refusal is the action's own answer, audited as a `permission.denied` record with status 403 (S01.12's permission list).
const SPEC = { route: TEXTS_PAGE, access: "hub", action: "sending.pause" } as const;

const deps: ControlDeps = { pause: messagingPause, nameOf: pausedByName, startSending, logError: logPauseError };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.texts.errors.forbidden",
  bad_request: "staff.texts.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.texts.errors.aal2Required",
};

/** An answer with the time it was given: the page keeps the state of both forms and shows the later one. */
const answered = (answer: TextsAnswer): TextsState => ({ ...answer, at: Date.now() });

const refused = (error: ActionRefusal): TextsState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Pause all texts", with the reason from the form (the form action's previous state and form data). */
export const pauseTextsAction = staffAction<[TextsState, FormData], TextsState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await pauseFromForm(deps, session, form);
    // The banner and the page read the switch again.
    revalidatePath(TEXTS_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Resume texts" (the same two arguments: the button carries no input). */
export const resumeTextsAction = staffAction<[TextsState, FormData], TextsState>(
  SPEC,
  async (session) => {
    const answer = await resumeFromForm(deps, session);
    revalidatePath(TEXTS_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
