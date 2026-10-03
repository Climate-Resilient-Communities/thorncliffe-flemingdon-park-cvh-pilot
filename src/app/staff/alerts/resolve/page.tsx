import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { forbiddenView } from "../composer/ComposerPage";
import type { ComposerQuery } from "../composer/loadComposer";
import { ResolvePage } from "./ResolvePage";

export const metadata: Metadata = { title: englishText("staff.compose.resolveTitle") };

/**
 * "Mark resolved" (O-16, S05.03): with `?alert=<id>` the start of the final message of a running alert (who it is for and the types carried over from the alert, the
 * words the author's); with `?alert=<id>&entry=<id>` the composer of the draft it made. Submit, approval, translation and freezing are the other composers' exactly,
 * and approving the final closes the alert as resolved. The policy action `alert.author_wide` (Coordinators and Admins; an Ambassador's own screen for their
 * buildings is E08's). Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage({ route: "/staff/alerts/resolve", access: "hub", action: "alert.author_wide", refused: forbiddenView }, async (_session, props: { searchParams?: Promise<ComposerQuery> }) => (
  <ResolvePage query={(await props.searchParams) ?? {}} />
));
