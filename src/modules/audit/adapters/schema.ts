// Drizzle tables of the audit module (AD-2), written by hand to match
// db/migrations/20261002010000_audit_event.sql; the drift test compares them.
// The append-only triggers and the grants live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, jsonb, pgEnum, pgPolicy, pgRole, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by the migration). */
export const cvhApp = pgRole("cvh_app").existing();

export const auditOutcome = pgEnum("audit_outcome", ["ok", "refused"]);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // References staff_account(id) once S01.05 creates it; null is the system.
    actorStaffId: uuid("actor_staff_id"),
    action: text().notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id"),
    outcome: auditOutcome().notNull(),
    isDrill: boolean("is_drill").notNull().default(false),
    meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("audit_event_at_idx").on(t.at),
    index("audit_event_subject_idx").on(t.subjectType, t.subjectId),
    check("audit_event_meta_is_object", sql`jsonb_typeof(meta) = 'object'`),
    pgPolicy("audit_event_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("audit_event_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

export type AuditEventRow = typeof auditEvent.$inferInsert;
