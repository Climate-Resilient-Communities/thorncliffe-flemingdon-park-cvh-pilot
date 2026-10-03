// The one render of the approval view's page (S04.07): the approval of an alert (O-05) and of an ambassador's post (O-07), at /staff/alerts/approve.
// Server only; the page itself is a staffPage() (the guard).
import { englishText } from "@/i18n/text";
import { Screen } from "@/ui";
import { approveAction, discardAction, returnAction } from "./actions";
import { ApprovalBody } from "./ApprovalBody";
import { loadApproval, type ApprovalQuery } from "./loadApproval";

const actions = { approve: approveAction, returnToAuthor: returnAction, discard: discardAction };

/**
 * What the page shows to someone the policy refuses: a role that may not approve, or a Coordinator or an Admin who wrote or changed the entry (a second
 * person has to approve it). The guard has already refused every call the page would make.
 */
export const forbiddenView = () => (
  <Screen surface="staff" width="review">
    <p role="alert" className="hub-error">
      {englishText("staff.approve.forbidden")}
    </p>
  </Screen>
);

export async function ApprovalPage({ query, viewerId }: { query: ApprovalQuery; viewerId: string }) {
  const screen = await loadApproval(query, viewerId);
  if ("kind" in screen) {
    return (
      <Screen surface="staff" width="review">
        <p role="alert" className="hub-error">
          {screen.message}
        </p>
        <a className="tap hub-link" href={screen.back.href}>
          {screen.back.label}
        </a>
      </Screen>
    );
  }
  return <ApprovalBody screen={screen} actions={actions} />;
}
