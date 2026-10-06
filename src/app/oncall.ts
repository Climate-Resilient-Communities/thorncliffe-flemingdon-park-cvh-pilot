// Composition root of the on-call roster (S06.07, AD-2): ops' roster on the app's database connection, with the audit trail and messaging's
// outbox (a removed number's waiting texts are skipped in the removing transaction). Server only. A seam of its own, like ./staff/messagingPause.ts,
// so the tests that call the staff page and actions directly can hand them a database.
import "server-only";
import * as audit from "@/modules/audit";
import { isOnDutyAdmin, readOnDutyCandidates, readStaffName } from "@/modules/identity";
import { createDeliveryQueue } from "@/modules/messaging";
import { createOncallRoster, type OncallRoster } from "@/modules/ops";
import { getDb } from "@/platform/db";

/** The on-call roster: list (masked), add and remove, and (S08.08) the on-duty entry, each audited without the number. */
export function oncallRoster(): OncallRoster {
  return createOncallRoster({
    db: getDb(),
    audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    // S08.08: an on-duty entry is an active Admin's with an authenticator, as identity reads it.
    onDutyAdmin: (executor, staffId) => isOnDutyAdmin(executor, staffId),
  });
}

/** The Admin accounts that can be on duty (S08.08: active, with an authenticator and their own password), by name, for the on-call page's choice. */
export function onDutyCandidates(): Promise<{ id: string; name: string }[]> {
  return readOnDutyCandidates(getDb());
}

/** The name of the account the on-duty entry belongs to (S08.08), for the page's line; null when the account is gone. */
export function onDutyName(staffId: string): Promise<string | null> {
  return readStaffName(getDb(), staffId);
}
