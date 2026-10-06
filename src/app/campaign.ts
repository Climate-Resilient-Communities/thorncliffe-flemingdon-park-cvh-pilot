// Composition root of the end-of-pilot re-consent campaign (S09.07, AD-2): subscriptions' campaign on the app's database, with what it may not import
// itself: messaging's outbox (the campaign texts, and the skip of a deleted pending sign-up's confirmation), the audit trail, the terms version a sign-up
// records now (the version the subscribers who stay accept), the price of a segment and the monthly spend cap's check (spend, with the ops event of an
// overrun). Server only. The Hub's End of the pilot page (/staff/campaign) and `/api/jobs/campaign-end` (pg_cron, with the job secret) are its callers.
import "server-only";
import * as audit from "@/modules/audit";
import { createDeliveryQueue, queuedCostCents } from "@/modules/messaging";
import { recordOpsEvent } from "@/modules/ops";
import { assessApproval } from "@/modules/spend";
import { createCampaigns, type CampaignEndReport, type CampaignSpendCap, type Campaigns } from "@/modules/subscriptions";
import { getEnv } from "@/platform/config/env";
import { getDb, type Db } from "@/platform/db";
import { currentSignupConsentVersion } from "./signup";

/**
 * The monthly cap's check of the campaign's texts (S07.08): the assessment an approval makes (the cap row locked last, the month's spending and the texts still
 * waiting against the cap), with the same consequence, a warning and never a refusal: an overrun is recorded as the ops event the health job texts the on-call
 * Admins about, on the campaign, and the use case audits it. The start has queued the campaign's texts in this transaction already, so the texts waiting
 * leave them out (`exceptCampaignId`, as an approval leaves out its entry's): they are counted once, as the estimate.
 */
export const campaignSpendCap: CampaignSpendCap = async (tx, input) => {
  const assessment = await assessApproval(tx, {
    estimateCents: input.estimateCents,
    queuedCents: () => queuedCostCents(tx, { exceptCampaignId: input.campaignId }),
    now: input.now,
  });
  if (assessment.capCents === null || assessment.overCents === 0) return null;
  await recordOpsEvent(tx, { kind: "spend.cap_overrun", subjectType: "campaign", subjectId: input.campaignId, detail: { over_cents: assessment.overCents } });
  return { overCents: assessment.overCents, capCents: assessment.capCents };
};

/** The campaign's use cases on the given database (the app's by default). */
export function campaignService(db: Db = getDb()): Campaigns {
  const queue = createDeliveryQueue();
  return createCampaigns({
    db,
    enqueue: (tx, input) => queue.enqueueCampaignDelivery(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    termsVersion: currentSignupConsentVersion,
    pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
    audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (database, event) => audit.recordRefusal(database, event) },
    spendCap: campaignSpendCap,
  });
}

/** One run of the end job: every campaign and rehearsal whose deadline has passed is ended (counts only in the answer). */
export function runCampaignEndJob(parts: { db?: Db } = {}): Promise<CampaignEndReport> {
  return campaignService(parts.db ?? getDb()).endDue();
}
