// The approval view's page data (S04.07): the entry as the use case reads it in one snapshot (its frozen texts and text messages, the author's
// role, the possible duplicate, and the number of people the text reaches right now: the count Approve then names), the buildings its audience is
// written in, the price of a segment, and the notice that all texts are paused when they are (S06.06). Server only.
import type { EntryReview } from "@/modules/alerting";
import type { BuildingFloorPlan } from "@/modules/places";
import { residentAlertsEnabled } from "../../../feedCache";
import { getEnv } from "@/platform/config/env";
import { alerting } from "../../alerts";
import { buildings } from "../../places";
import { pauseNoticeForApprover } from "../../pauseNotice";
import { approvalScreen, missingApproval, type ApprovalScreen, type MissingApproval } from "./view";

export interface ApprovalQuery {
  alert?: string | string[];
  entry?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The entry a query names, as a reference; empty ids when it names none (the use cases then say "not found"). */
export const refOfQuery = (query: ApprovalQuery): { alertId: string; entryId: string } => ({ alertId: first(query.alert) ?? "", entryId: first(query.entry) ?? "" });

/** What the page reads; every part can be replaced in a test. */
export interface ApprovalLoadDeps {
  review: (ref: { alertId: string; entryId: string }) => Promise<EntryReview | null>;
  plans: () => Promise<readonly BuildingFloorPlan[]>;
  pricePerSegmentCents: () => number;
  /** The launch switch for resident alerts (`residentAlertsEnabled()`). */
  residentAlertsEnabled: () => boolean;
  /** `pauseNoticeForApprover()` (S06.06): the sentence while texts are paused, null otherwise. */
  pauseNotice: () => Promise<string | null>;
  /** Where a notice that could not be read is logged (the error's name only). */
  logError: (event: string, fields: Record<string, string>) => void;
}

const live: ApprovalLoadDeps = {
  review: (ref) => alerting().review(ref),
  plans: () => buildings().listFloorPlans(),
  pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
  residentAlertsEnabled: () => residentAlertsEnabled(),
  pauseNotice: () => pauseNoticeForApprover(),
  logError: (event, fields) => console.error(JSON.stringify({ evt: event, module: "alerting", ...fields })),
};

/**
 * The approval view for the entry `?alert=<id>&entry=<id>` names, or the screen for one that is not there. The pause notice only informs: it is read
 * after the entry, and whatever goes wrong reading it is logged and the view is shown without it, so it can never keep an approver from approving.
 */
export async function loadApproval(query: ApprovalQuery, viewerId: string, deps: ApprovalLoadDeps = live): Promise<ApprovalScreen | MissingApproval> {
  const review = await deps.review(refOfQuery(query));
  if (!review) return missingApproval();
  let pauseNotice: string | null = null;
  try {
    pauseNotice = await deps.pauseNotice();
  } catch (error) {
    deps.logError("approval.pause_notice_failed", { error: error instanceof Error ? error.name : "NonError" });
  }
  return approvalScreen({ review, plans: await deps.plans(), pricePerSegmentCents: deps.pricePerSegmentCents(), viewerId, pauseNotice, residentAlertsEnabled: deps.residentAlertsEnabled() });
}
