// Composition root of the resend for the staff surface (S09.02, AD-2): the messaging module's resend on the app's database connection (cvh_app_login), with the three
// things it may not import itself: the resident's standing (subscriptions), the entry's and thread's standing (alerting's reader, the one the sender's hand-off point
// uses) and the monthly spend cap's check (spend, with the ops event of an overrun). Server only. A seam of its own, like ./messagingPause.ts and ./spendSeam.ts, so the
// tests that call the staff pages and actions directly can hand them a database.
import { alertStandingReader, checkSpendCap } from "@/modules/alerting";
import { createResend, queuedCostCents, stdoutMessagingLog, type Resend, type ResendSpendCap } from "@/modules/messaging";
import { subscriberReceives } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";

/**
 * The monthly cap's check of a batch of resends (S07.08): the same assessment an approval makes (`assessApproval`, the cap row locked last, the month's spending and the
 * texts still waiting against the cap), with the same consequence, which is a warning and never a refusal: an overrun is recorded as the ops event the health job texts
 * the on-call Admins about, and the use case audits it.
 */
export const resendSpendCap: ResendSpendCap = (tx, input) =>
  checkSpendCap(tx, { entryId: input.entryId, estimateCents: input.estimateCents, queuedCents: () => queuedCostCents(tx), now: input.now });

/** The resend: the Admin's one way to send a text a second time. */
export function resendService(): Resend {
  return createResend({
    db: getDb(),
    recipients: { receives: (tx, recipient) => (recipient.kind === "subscriber" ? subscriberReceives(tx, recipient.id) : Promise.resolve(false)) },
    standing: { standingOf: (tx, entryId) => alertStandingReader.standingOf(tx, entryId, 0) },
    spendCap: resendSpendCap,
  });
}

/**
 * Starts a dispatcher run right after a resend has committed (`kickDispatcher`), so the new texts go out now and not at pg_cron's next minute (the same as an approval's
 * and a resume's). It never throws and never waits for the run. The run lives inside the request's function after the response, so the page that resends exports
 * `maxDuration = 60`. Imported when it is needed: the sender's composition (Twilio, the job secret) is not part of every Hub screen.
 */
export async function startSending(): Promise<void> {
  const { kickDispatcher } = await import("../dispatch");
  kickDispatcher();
}

/** Operational error log (structured, no personal data). */
export function logResendError(event: string, fields: Record<string, string>): void {
  stdoutMessagingLog.error(event, fields);
}
