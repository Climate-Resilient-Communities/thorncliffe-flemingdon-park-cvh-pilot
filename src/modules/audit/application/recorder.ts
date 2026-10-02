import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { AUDIT_ACTIONS, AuditRecordError, toAuditRecord, type AuditAction, type AuditEvent, type AuditRecord } from "../domain/actions";

/** Port: stores one validated record using the given executor. */
export interface AuditStore {
  insert(executor: DbExecutor, record: AuditRecord): Promise<void>;
}

/** Port: the operational error log (structured, no personal data). */
export interface OperationalLog {
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
}

export interface AuditRecorder {
  record<A extends AuditAction>(tx: DbTransaction, event: AuditEvent<A>): Promise<void>;
  recordRefusal<A extends AuditAction>(db: Db, event: AuditEvent<A>): Promise<void>;
}

// Only what cannot hold personal data: a database error's message, detail or
// failed query may quote the row, so only its name and SQLSTATE (Drizzle wraps
// the driver's error as its cause) are kept; an AuditRecordError's message
// names fields, never values.
function errorFields(error: unknown) {
  type Described = { code?: unknown; cause?: { code?: unknown } };
  const { code, cause } = (error ?? {}) as Described;
  const sqlState = typeof code === "string" ? code : cause?.code;
  return {
    error: error instanceof Error ? error.constructor.name : "unknown",
    error_code: typeof sqlState === "string" ? sqlState : null,
    message: error instanceof AuditRecordError ? error.message : null,
  };
}

export function createAuditRecorder({ store, log }: { store: AuditStore; log: OperationalLog }): AuditRecorder {
  return {
    /**
     * Writes the `ok` record of a change inside the change's own transaction,
     * so the two commit or roll back together. Throws if the event is invalid
     * or the insert fails: the caller lets it propagate, so the whole change
     * fails and nothing is saved (fail closed).
     */
    async record(tx, event) {
      await store.insert(tx, toAuditRecord(event, "ok"));
    },

    /**
     * Writes the `refused` record of a refused or failed action in its own
     * transaction, after the business transaction was rolled back or never
     * started, so the record survives. Never throws: if the record cannot be
     * written the action stays refused and the failure is logged as an
     * operational error.
     */
    async recordRefusal(db, event) {
      try {
        const record = toAuditRecord(event, "refused");
        await db.transaction(async (tx) => {
          await store.insert(tx, record);
        });
      } catch (error) {
        log.error("audit.refusal_not_recorded", {
          action: AUDIT_ACTIONS.includes(event?.action) ? event.action : "unknown",
          ...errorFields(error),
        });
      }
    },
  };
}
