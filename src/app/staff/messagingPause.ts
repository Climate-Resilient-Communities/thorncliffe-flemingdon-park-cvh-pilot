// Composition root of the pause for the staff surface (S06.06, AD-2): the messaging module's pause on the app's database connection
// (cvh_app_login), the name of whoever paused, and the start of a dispatcher run once texts are resumed. Server only. A seam of its own,
// like ./directory.ts and ./places.ts, so the tests that call the staff pages and actions directly can hand them a database.
import { readStaffName } from "@/modules/identity";
import { createMessagingPause, stdoutMessagingLog, type MessagingPause } from "@/modules/messaging";
import { getDb } from "@/platform/db";

/** The pause switch: what it says now, pause and resume. */
export function messagingPause(): MessagingPause {
  return createMessagingPause({ db: getDb() });
}

/** The name of the staff member who paused texts, from identity (messaging holds only their id); null when there is no such account. */
export function pausedByName(staffId: string): Promise<string | null> {
  return readStaffName(getDb(), staffId);
}

/**
 * Starts a dispatcher run right after a resume has committed (`kickDispatcher`, AD-8), so the texts that waited go out now and not at
 * pg_cron's next minute. It never throws and never waits for the run. The run lives inside the resuming request's function after the
 * response, so the page that resumes exports `maxDuration = 60` (src/app/staff/texts/page.tsx). Imported when it is needed: the sender's
 * composition (Twilio, the job secret) is not part of every Hub screen.
 */
export async function startSending(): Promise<void> {
  const { kickDispatcher } = await import("../dispatch");
  kickDispatcher();
}

/** Operational error log (structured, no personal data). */
export function logPauseError(event: string, fields: Record<string, string>): void {
  stdoutMessagingLog.error(event, fields);
}
