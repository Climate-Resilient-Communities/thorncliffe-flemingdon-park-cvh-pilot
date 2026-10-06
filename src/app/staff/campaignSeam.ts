// Composition root of the end-of-pilot campaign for the staff surface (S09.07, AD-2): subscriptions' campaign on the app's database connection (src/app/campaign.ts),
// the names of the Admins who started it and reopened sign-ups (identity), what became of its texts (messaging) and the start of a dispatcher run once texts are
// queued. Server only. A seam of its own, like ./messagingPause.ts and ./resendSeam.ts, so the tests that call the staff pages and actions directly can hand them a
// database.
import { readStaffName } from "@/modules/identity";
import { campaignTextCounts, stdoutMessagingLog, type CampaignTextCounts } from "@/modules/messaging";
import type { Campaigns } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";
import { campaignService as appCampaignService } from "../campaign";

/** The campaign's use cases. */
export function campaignService(): Campaigns {
  return appCampaignService(getDb());
}

/** The name of a staff member (who started the campaign, who reopened sign-ups); null when there is no such account. */
export function staffName(staffId: string): Promise<string | null> {
  return readStaffName(getDb(), staffId);
}

/** What became of one campaign's texts (its rehearsal's, or the real one's): counts only. */
export function textCounts(campaignId: string): Promise<CampaignTextCounts> {
  return campaignTextCounts(getDb(), campaignId);
}

/**
 * Starts a dispatcher run right after the texts are queued (`kickDispatcher`), so they go out now and not at pg_cron's next minute. It never throws and never
 * waits for the run; the page exports `maxDuration = 60`. Imported when it is needed: the sender's composition is not part of every Hub screen.
 */
export async function startSending(): Promise<void> {
  const { kickDispatcher } = await import("../dispatch");
  kickDispatcher();
}

/** Operational error log (structured, no personal data). */
export function logCampaignError(event: string, fields: Record<string, string>): void {
  stdoutMessagingLog.error(event, fields);
}
