// The approval view's page data (S04.07): the entry as the use case reads it in one snapshot (its frozen texts and text messages, the author's
// role, the possible duplicate, and the number of people the text reaches right now: the count Approve then names), the buildings its audience is
// written in, and the price of a segment. Server only.
import { getEnv } from "@/platform/config/env";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { approvalScreen, missingApproval, type ApprovalScreen, type MissingApproval } from "./view";

export interface ApprovalQuery {
  alert?: string | string[];
  entry?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The entry a query names, as a reference; empty ids when it names none (the use cases then say "not found"). */
export const refOfQuery = (query: ApprovalQuery): { alertId: string; entryId: string } => ({ alertId: first(query.alert) ?? "", entryId: first(query.entry) ?? "" });

/** The approval view for the entry `?alert=<id>&entry=<id>` names, or the screen for one that is not there. */
export async function loadApproval(query: ApprovalQuery, viewerId: string): Promise<ApprovalScreen | MissingApproval> {
  const review = await alerting().review(refOfQuery(query));
  if (!review) return missingApproval();
  return approvalScreen({ review, plans: await buildings().listFloorPlans(), pricePerSegmentCents: getEnv().smsPricePerSegmentCents, viewerId });
}
