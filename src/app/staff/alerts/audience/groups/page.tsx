import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { ExerciseMarker } from "../../../ExerciseMarker";
import { staffPage } from "../../../guard";
import { saveGroupsAction, savePlaceAction } from "../actions";
import { AudienceBody } from "../AudienceBody";
import { loadDraft, type AudienceQuery } from "../loadDraft";
import { groupsScreen, lockedScreen, missingScreen, savedNotice } from "../view";

export const metadata: Metadata = { title: englishText("staff.audience.groupsTitle") };

const actions = { place: savePlaceAction, groups: saveGroupsAction };

/**
 * "Who is this alert for? The groups" (O-04, S04.04): the policy action `alert.author_wide` (Coordinators and Admins). The
 * groups residents chose to join, stored on the audience of the draft named by `?alert=<id>&entry=<id>`; the page says that
 * groups narrow who is texted but every web reader can still see the alert. Same guard, refusal view and no-store
 * responses as the place page.
 */
export default staffPage(
  {
    route: "/staff/alerts/audience/groups",
    access: "hub",
    action: "alert.author_wide",
    refused: () => (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error">{englishText("staff.audience.errors.forbidden")}</p>
      </Screen>
    ),
  },
  async (_session, props: { searchParams?: Promise<AudienceQuery> }) => {
    const query = (await props.searchParams) ?? {};
    const draft = await loadDraft(query);
    const screen = !draft
      ? missingScreen()
      : draft.status !== "draft"
        ? lockedScreen(draft.plans, draft.audience, undefined, draft.from, draft.ref)
        : groupsScreen(draft.plans, draft.audience, draft.ref, { notice: savedNotice(query), from: draft.from });
    return (
      <Screen surface="staff" width="review">
        {draft?.exercise ? <ExerciseMarker words={draft.exercise} /> : null}
        <AudienceBody screen={screen} actions={actions} />
      </Screen>
    );
  },
);
