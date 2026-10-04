// Composition root of the drills (S06.05, AD-2): subscriptions' drill roster on the app's database connection, with the audit trail and messaging's outbox (a removed
// member's waiting texts are skipped in the removing transaction); alerting's list of drill threads; and messaging's results of a drill. Server only. A seam of its own,
// like ./oncall.ts and ./staff/messagingPause.ts, so the tests that call the staff pages and actions directly can hand them a database.
import "server-only";
import { createDrillThreads, type DrillThreads } from "@/modules/alerting";
import * as audit from "@/modules/audit";
import { createDeliveryQueue, drillResults, type DrillResults } from "@/modules/messaging";
import { createDrillRoster, type DrillRoster } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";

/** The drill roster: list (masked), add, edit and remove, each audited without the number, the label or the language. */
export function drillRoster(): DrillRoster {
  return createDrillRoster({
    db: getDb(),
    audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
}

/** The recent drill threads, newest first. */
export function drillThreads(): DrillThreads {
  return createDrillThreads({ db: getDb() });
}

/** What became of a drill's texts, per roster member and language, apart from every real alert's counts. */
export function drillResultsReader(): { forAlert(alertId: string): ReturnType<DrillResults["forAlert"]> } {
  return { forAlert: (alertId) => drillResults.forAlert(getDb(), alertId) };
}
