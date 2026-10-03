import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { staffPage } from "../../guard";
import { saveGroupsAction, savePlaceAction } from "./actions";
import { AudienceBody } from "./AudienceBody";
import { loadDraft, type AudienceQuery } from "./loadDraft";
import { lockedScreen, missingScreen, placeScreen, savedNotice } from "./view";

export const metadata: Metadata = { title: englishText("staff.audience.placeTitle") };

const actions = { place: savePlaceAction, groups: saveGroupsAction };

/**
 * "Who is this alert for? The place" (O-03, S04.04): the policy action `alert.author_wide`, which a Coordinator and an
 * Admin have (S01.12). The neighbourhood, or buildings each with the whole building or chosen floors, of the draft named
 * by `?alert=<id>&entry=<id>`. Staff at the Hub only (the guard sends everyone else to sign-in or their setup gate);
 * another role sees "Only a Coordinator or an Admin can choose who an alert is for." and the action refuses it on its own.
 * Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/audience",
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
        : placeScreen(draft.plans, draft.audience, draft.ref, { notice: savedNotice(query), from: draft.from });
    return (
      <Screen surface="staff" width="review">
        <AudienceBody screen={screen} actions={actions} />
      </Screen>
    );
  },
);
