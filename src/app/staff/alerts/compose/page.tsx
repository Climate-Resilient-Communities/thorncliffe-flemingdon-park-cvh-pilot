import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { ComposerPage, forbiddenView } from "../composer/ComposerPage";
import type { ComposerQuery } from "../composer/loadComposer";

export const metadata: Metadata = { title: englishText("staff.compose.alertTitle") };

/**
 * The full alert composer (O-02, S04.05). With no draft named it starts where "Log a disruption" does (the types, the place and the time
 * of the first report); with `?alert=<id>&entry=<id>` it is the composer of that draft: the types, where things stand, the text and the
 * valid-until, saved and submitted for a second person to approve. The policy action `alert.author_wide` (Coordinators and Admins).
 * Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/alerts/compose", access: "hub", action: "alert.author_wide", refused: forbiddenView }, async (_session, props: { searchParams?: Promise<ComposerQuery> }) => (
  <ComposerPage mode="alert" query={(await props.searchParams) ?? {}} />
));
