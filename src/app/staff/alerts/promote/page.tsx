import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { forbiddenView } from "../composer/ComposerPage";
import type { ComposerQuery } from "../composer/loadComposer";
import { UpdatePage } from "../update/UpdatePage";

export const metadata: Metadata = { title: englishText("staff.compose.promoteTitle") };

/**
 * "Promote to full alert" (O-13, S05.01): the first update to an acknowledgement, on the same composer as every update. The acknowledgement's audience,
 * types and languages are carried over, the phase is required, and the valid-until defaults to the acknowledgement's choice. The policy action
 * `alert.author_wide` (Coordinators and Admins). Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/alerts/promote", access: "hub", action: "alert.author_wide", refused: forbiddenView }, async (_session, props: { searchParams?: Promise<ComposerQuery> }) => (
  <UpdatePage flavor="promote" query={(await props.searchParams) ?? {}} />
));
