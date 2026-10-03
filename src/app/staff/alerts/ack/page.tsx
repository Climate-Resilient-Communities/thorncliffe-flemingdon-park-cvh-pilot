import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { ComposerPage, forbiddenView } from "../composer/ComposerPage";
import type { ComposerQuery } from "../composer/loadComposer";

export const metadata: Metadata = { title: englishText("staff.compose.ackTitle") };

/**
 * The acknowledgement composer (O-12, S04.05): the draft of a logged disruption, starting from a suggested text for its type and place.
 * The author reads it, changes it if they need to, saves it and submits it for a second person to approve. The policy action
 * `alert.author_wide`, which a Coordinator and an Admin have (S01.12); another role sees "Only a Coordinator or an Admin can write an
 * alert." and every call the page makes refuses it on its own. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/alerts/ack", access: "hub", action: "alert.author_wide", refused: forbiddenView }, async (_session, props: { searchParams?: Promise<ComposerQuery> }) => (
  <ComposerPage mode="ack" query={(await props.searchParams) ?? {}} />
));
