import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { forbiddenView } from "../composer/ComposerPage";
import { ReplacePage } from "./ReplacePage";
import type { ReplaceQuery } from "./loadReplace";

export const metadata: Metadata = { title: englishText("staff.compose.correctTitle") };

/**
 * "Correct" (O-15, S05.02): with `?alert=<id>` the entries of a running alert that can be corrected, and with `&target=<id>` the form for one (its words to change, where
 * things stand, the valid-until; who it is for is carried over from the alert); with `?alert=<id>&entry=<id>` the composer of the correction it made. Submit, approval,
 * translation and freezing are the other composers' exactly. The policy action is `alert.correct`: a Coordinator or an Admin; an Ambassador's own pending entries
 * are corrected on their own screen (S08.04: the entry the guard judges on here is one nobody wrote in this call), and a Director has no access. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/correct",
    access: "hub",
    action: "alert.correct",
    refused: forbiddenView,
    context: async () => ({ entry: { authorId: "00000000-0000-0000-0000-000000000000", editorIds: [], status: "pending_approval" } }),
  },
  async (_session, props: { searchParams?: Promise<ReplaceQuery> }) => <ReplacePage mode="correct" query={(await props.searchParams) ?? {}} />,
);
