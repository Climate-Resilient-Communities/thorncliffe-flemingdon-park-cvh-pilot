import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { staffPage } from "../../guard";
import { forbiddenView } from "../composer/ComposerPage";
import { ReplacePage } from "../correct/ReplacePage";
import type { ReplaceQuery } from "../correct/loadReplace";

export const metadata: Metadata = { title: englishText("staff.compose.withdrawTitle") };

/**
 * "Withdraw" (O-15, S05.02): with `?alert=<id>` the entries of a running alert that can be withdrawn, and with `&target=<id>` the form for one (the reason from the
 * catalog, and the words for residents); with `?alert=<id>&entry=<id>` the composer of the withdrawal it made. The policy action is `alert.withdraw`, judged as
 * "Correct" is. Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/withdraw",
    access: "hub",
    action: "alert.withdraw",
    refused: forbiddenView,
    context: async () => ({ entry: { authorId: "00000000-0000-0000-0000-000000000000", editorIds: [], status: "pending_approval" } }),
  },
  async (_session, props: { searchParams?: Promise<ReplaceQuery> }) => <ReplacePage mode="withdraw" query={(await props.searchParams) ?? {}} />,
);
