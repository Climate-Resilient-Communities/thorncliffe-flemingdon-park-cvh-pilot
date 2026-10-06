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
import { progressReader, textsArePaused } from "../../sendingProgress";
import { sendingBlock } from "../sending/load";
import type { SendingBlock } from "../sending/view";
import { capNoticeFor } from "../../spendSeam";
import { approvalScreen, missingApproval, spendEstimateCents, type ApprovalScreen, type MissingApproval } from "./view";

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
  /**
   * `capNoticeFor(estimateCents)` (S07.08): the sentence when month-to-date text spending plus this entry's estimate would pass the monthly cap, null
   * otherwise. It never throws and never blocks.
   */
  capNotice: (estimateCents: number | null) => Promise<string | null>;
  /** What became of the entry's texts (S06.09), for the confirmation of an approved entry. */
  sending: (review: EntryReview) => Promise<SendingBlock | null>;
  /** Where a notice that could not be read is logged (the error's name only). */
  logError: (event: string, fields: Record<string, string>) => void;
}

const live: ApprovalLoadDeps = {
  review: (ref) => alerting().review(ref),
  plans: () => buildings().listFloorPlans(),
  pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
  residentAlertsEnabled: () => residentAlertsEnabled(),
  pauseNotice: () => pauseNoticeForApprover(),
  capNotice: (estimateCents) => capNoticeFor(estimateCents),
  sending: (review) => sendingBlock(review, { progress: progressReader(), paused: textsArePaused, logError: (event, fields) => console.error(JSON.stringify({ evt: event, module: "alerting", ...fields })) }),
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
  // The monthly cap (S07.08), told before the approver decides: only for an entry waiting for approval, and only ever a note (it cannot fail the view).
  let capNotice: string | null = null;
  if (review.entry.status === "pending_approval") {
    try {
      capNotice = await deps.capNotice(spendEstimateCents(review.sms, review.recipients, deps.pricePerSegmentCents()));
    } catch (error) {
      deps.logError("approval.cap_notice_failed", { error: error instanceof Error ? error.name : "NonError" });
    }
  }
  // What became of an approved entry's texts; it never throws (a failure is a note in its place), so it can never keep the confirmation from being shown.
  const sending = review.entry.status === "approved" ? await deps.sending(review) : null;
  return approvalScreen({ review, plans: await deps.plans(), pricePerSegmentCents: deps.pricePerSegmentCents(), viewerId, pauseNotice, capNotice, residentAlertsEnabled: deps.residentAlertsEnabled(), sending });
}
