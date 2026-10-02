// The audit module's public interface (AD-2, AD-14). Other modules and the app
// write audit records only through these functions.
import { drizzleAuditStore } from "./adapters/auditStore";
import { stdoutOperationalLog } from "./adapters/operationalLog";
import { createAuditRecorder } from "./application/recorder";

const recorder = createAuditRecorder({ store: drizzleAuditStore, log: stdoutOperationalLog });

/**
 * `record(tx, event)`: writes the `ok` record inside the caller's transaction
 * (or on the client). Throws if it cannot, so the caller's change rolls back.
 */
export const record = recorder.record;

/**
 * `recordRefusal(db, event)`: writes the `refused` record in its own
 * transaction, after the refused change was rolled back or never started.
 * Never throws; a failure is logged as an operational error.
 */
export const recordRefusal = recorder.recordRefusal;

export {
  AUDIT_ACTIONS,
  AuditRecordError,
  REFUSAL_REASONS,
  STAFF_ROLES,
  type AuditAction,
  type AuditEvent,
  type AuditMeta,
} from "./domain/actions";
