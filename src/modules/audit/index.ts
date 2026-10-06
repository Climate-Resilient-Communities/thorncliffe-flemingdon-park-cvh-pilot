// The audit module's public interface (AD-2, AD-14). Other modules and the app
// write audit records only through these functions.
import { drizzleAuditStore } from "./adapters/auditStore";
import { stdoutOperationalLog } from "./adapters/operationalLog";
import { createAuditRecorder } from "./application/recorder";

const recorder = createAuditRecorder({ store: drizzleAuditStore, log: stdoutOperationalLog });

/**
 * `record(tx, event)`: writes the `ok` record inside the caller's transaction
 * (a `DbTransaction`, so it cannot be written outside the change). Throws if it cannot, so the caller's change rolls back.
 */
export const record = recorder.record;

/**
 * `recordRefusal(db, event)`: writes the `refused` record in its own
 * transaction, after the refused change was rolled back or never started.
 * Never throws; a failure is logged as an operational error.
 */
export const recordRefusal = recorder.recordRefusal;

/**
 * `readAuditRecords(executor, { subjectType, actions, subjectId? })`: the records of a subject type, oldest first (S09.03: a resident's access request is kept
 * only as its audit records). Reading never changes the trail.
 */
export { readAuditRecords, type AuditRow } from "./adapters/auditRead";

export {
  ACCESS_REQUEST_KINDS,
  ACCESS_REQUEST_OUTCOMES,
  AUDIT_ACTIONS,
  AuditRecordError,
  FACTOR_RESET_REASONS,
  REFUSAL_REASONS,
  STAFF_ROLES,
  SYSTEM_ACTOR,
  type AuditAction,
  type AuditEvent,
  type AuditMeta,
  type AuditOutcome,
} from "./domain/actions";
