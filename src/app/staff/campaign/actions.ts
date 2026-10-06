"use server";

import { revalidatePath } from "next/cache";
import { englishText } from "@/i18n/text";
import { staffAction, type ActionRefusal } from "../guard";
import { campaignService, logCampaignError, startSending } from "../campaignSeam";
import { rehearseFromForm, reopenFromForm, startFromForm, type CampaignAnswer, type CampaignState, type ControlDeps } from "./control";
import { CAMPAIGN_PAGE } from "./view";

// "Rehearse on the drill roster", "Start the campaign" and "Reopen sign-ups for the MVP" are the policy action `campaign.run` (AD-4: Admins only), which is also
// privileged (S01.10): the guard refuses any other role, then a session below aal2, before the action's own code, whatever the screen showed; the database reads
// the session's level again when the campaign row is written. Called directly the refusal is the action's own answer, audited as a `permission.denied` record with
// status 403 (S01.12's permission list).
const SPEC = { route: CAMPAIGN_PAGE, access: "hub", action: "campaign.run" } as const;

const deps: ControlDeps = { campaigns: campaignService, startSending, logError: logCampaignError };

// These actions declare no `context`, so a `bad_request` cannot arise; it reads as forbidden.
const REFUSAL_KEYS: Record<ActionRefusal, string> = {
  forbidden: "staff.campaign.errors.forbidden",
  bad_request: "staff.campaign.errors.forbidden",
  setup_incomplete: "staff.setup.incomplete",
  aal2_required: "staff.campaign.errors.aal2Required",
};

/** An answer with the time it was given: the page keeps the state of every form and shows the latest. */
const answered = (answer: CampaignAnswer): CampaignState => ({ ...answer, at: Date.now() });

const refused = (error: ActionRefusal): CampaignState => answered({ status: "refused", message: englishText(REFUSAL_KEYS[error]) });

/** "Rehearse on the drill roster" (the form action's previous state and form data: the page's key and the deadline it showed). */
export const rehearseCampaignAction = staffAction<[CampaignState, FormData], CampaignState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await rehearseFromForm(deps, session, form);
    revalidatePath(CAMPAIGN_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Start the campaign" (the page's key, the deadline it showed and the box the Admin ticked). */
export const startCampaignAction = staffAction<[CampaignState, FormData], CampaignState>(
  SPEC,
  async (session, _previous, form) => {
    const answer = await startFromForm(deps, session, form);
    revalidatePath(CAMPAIGN_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);

/** "Reopen sign-ups for the MVP" (the button carries no input). */
export const reopenSignupsAction = staffAction<[CampaignState, FormData], CampaignState>(
  SPEC,
  async (session) => {
    const answer = await reopenFromForm(deps, session);
    revalidatePath(CAMPAIGN_PAGE);
    return answered(answer);
  },
  (error) => refused(error),
);
