// Drizzle tables of the audit module (AD-2), written by hand to match
// db/migrations/20261002010000_audit_event.sql (and the actor foreign key added
// by 20261002110000_staff_account.sql); the drift test compares them.
// The append-only triggers and the grants live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, jsonb, pgEnum, pgPolicy, pgRole, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by the migration). */
export const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be
 * declared: Drizzle needs a table object, and audit may not import identity
 * (AD-2). Not exported, so nothing reads or writes it through this module; the
 * real definition is src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

export const auditOutcome = pgEnum("audit_outcome", ["ok", "refused"]);

export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    // A staff account (no ON DELETE action: accounts are never deleted); null is the system.
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
    index("audit_event_actor_staff_id_idx").on(t.actorStaffId),
    foreignKey({ name: "audit_event_actor_staff_id_fkey", columns: [t.actorStaffId], foreignColumns: [staffAccountKey.id] }),
    check("audit_event_meta_is_object", sql`jsonb_typeof(meta) = 'object'`),
    pgPolicy("audit_event_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("audit_event_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

export type AuditEventRow = typeof auditEvent.$inferInsert;
