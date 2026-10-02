import type { AuditStore } from "../application/recorder";
import { auditEvent } from "./schema";

/** Stores audit records with Drizzle, in whatever transaction it is given. */
export const drizzleAuditStore: AuditStore = {
  async insert(executor, record) {
    await executor.insert(auditEvent).values({
      actorStaffId: record.actorStaffId,
      action: record.action,
      subjectType: record.subjectType,
      subjectId: record.subjectId,
      outcome: record.outcome,
      isDrill: record.isDrill,
      meta: record.meta,
    });
  },
};
