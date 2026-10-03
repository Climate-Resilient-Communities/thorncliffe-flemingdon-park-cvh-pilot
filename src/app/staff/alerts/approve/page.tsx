import type { Metadata } from "next";
import { englishText } from "@/i18n/text";
import { alerting } from "../../alerts";
import { staffPage } from "../../guard";
import { approvalFacts } from "../approval/entryFacts";
import { ApprovalPage, forbiddenView } from "../approval/ApprovalPage";
import { refOfQuery, type ApprovalQuery } from "../approval/loadApproval";

export const metadata: Metadata = { title: englishText("staff.approve.title") };

/**
 * The approval's actions live in this function, and so does what follows an approval that committed: the dispatcher is kicked after the commit
 * (S06.02's `kickDispatcher()`, called by src/app/staff/alerts/approval/afterApproval.ts), and its run lives in this function after the response and
 * shares its time. The segment's `maxDuration` must therefore be a literal 60 (Next.js reads it statically; approvalKick.test.ts reads it from this
 * file), as the submit route's is.
 */
export const maxDuration = 60;

/**
 * The approval view of an entry (O-05 an alert, O-07 an ambassador's post, S04.07): a Coordinator or an Admin who is not an editor reads exactly what goes
 * out and approves it, returns it to its author with a note, or discards it. The policy action is `alert.approve` with the entry's editors (read from the
 * database, never the request), so an editor, a Director and an Ambassador see "Only a Coordinator or an Admin who did not write or change this alert can
 * approve it." and every call the page makes refuses them on its own (and at `aal2` only). Responses are no-store. The shell (layout.tsx) owns the <main>.
 */
export default staffPage(
  {
    route: "/staff/alerts/approve",
    access: "hub",
    action: "alert.approve",
    refused: forbiddenView,
    context: async (_session, props: { searchParams?: Promise<ApprovalQuery> }) => approvalFacts(alerting(), refOfQuery((await props.searchParams) ?? {})),
  },
  async (session, props: { searchParams?: Promise<ApprovalQuery> }) => <ApprovalPage query={(await props.searchParams) ?? {}} viewerId={session.staffId} />,
);
