// Composition root of the on-call roster (S06.07, AD-2): ops' roster on the app's database connection, with the audit trail and messaging's
// outbox (a removed number's waiting texts are skipped in the removing transaction). Server only. A seam of its own, like ./staff/messagingPause.ts,
// so the tests that call the staff page and actions directly can hand them a database.
import "server-only";
import * as audit from "@/modules/audit";
import { createDeliveryQueue } from "@/modules/messaging";
import { createOncallRoster, type OncallRoster } from "@/modules/ops";
import { getDb } from "@/platform/db";

/** The on-call roster: list (masked), add and remove, each audited without the number. */
export function oncallRoster(): OncallRoster {
  return createOncallRoster({
    db: getDb(),
    audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
}
