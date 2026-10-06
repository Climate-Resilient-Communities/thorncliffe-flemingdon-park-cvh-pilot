import { and, asc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import type { AuditAction, AuditOutcome } from "../domain/actions";
import { auditEvent } from "./schema";

/** An audit record as it was stored: what every record holds, and nothing a record cannot hold (no number, no body, no token). */
export interface AuditRow {
  id: number;
  at: Date;
  action: AuditAction;
  actorStaffId: string | null;
  subjectId: string | null;
  outcome: AuditOutcome;
  isDrill: boolean;
  meta: Record<string, unknown>;
}

/**
 * The records of one subject type, of the given actions (of one subject when `subjectId` is given), oldest first, read through the executor the caller is
 * in. For a use case that keeps its own state in the audit trail (S09.03: a resident's access request is its `received` and `closed` records, with no table
 * of its own), so it can say what is open and refuse to close a request twice. The trail stays append-only: this only reads.
 */
export async function readAuditRecords(
  executor: DbExecutor,
  query: { subjectType: string; actions: readonly AuditAction[]; subjectId?: string },
): Promise<AuditRow[]> {
  if (query.actions.length === 0) return [];
  const rows = await executor
    .select({
      id: auditEvent.id,
      at: auditEvent.at,
      action: auditEvent.action,
      actorStaffId: auditEvent.actorStaffId,
      subjectId: auditEvent.subjectId,
      outcome: auditEvent.outcome,
      isDrill: auditEvent.isDrill,
      meta: auditEvent.meta,
    })
    .from(auditEvent)
    .where(
      and(
        eq(auditEvent.subjectType, query.subjectType),
        inArray(auditEvent.action, [...query.actions]),
        query.subjectId === undefined ? undefined : eq(auditEvent.subjectId, query.subjectId),
      ),
    )
    .orderBy(asc(auditEvent.id));
  return rows.map((row) => ({ ...row, action: row.action as AuditAction }));
}
