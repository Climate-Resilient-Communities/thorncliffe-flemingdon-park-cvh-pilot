// Drift test fixture: variants of schema-matching.ts's tables that each differ
// from migrations/ in one way. The test swaps one in at a time.
import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { staffAccount } from "./schema-matching";

const auditOutcome = pgEnum("audit_outcome", ["ok", "refused"]);

const columns = () => ({
  id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id").references(() => staffAccount.id, { onDelete: "set null" }),
  action: text().notNull(),
  outcome: auditOutcome().notNull().default("ok"),
  detail: jsonb(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

/** action is nullable here, NOT NULL in the migration. */
export const actionNullable = pgTable(
  "audit_event",
  { ...columns(), action: text() },
  (t) => [index("audit_event_occurred_at_idx").on(t.occurredAt)],
).enableRLS();

/** A column the migrations never added. */
export const extraColumn = pgTable(
  "audit_event",
  { ...columns(), note: text() },
  (t) => [index("audit_event_occurred_at_idx").on(t.occurredAt)],
).enableRLS();

/** occurred_at without time zone. */
export const wrongType = pgTable(
  "audit_event",
  { ...columns(), occurredAt: timestamp("occurred_at").notNull().defaultNow() },
  (t) => [index("audit_event_occurred_at_idx").on(t.occurredAt)],
).enableRLS();

/** The index is missing. */
export const missingIndex = pgTable("audit_event", columns()).enableRLS();

/** RLS is not declared. */
export const rlsOff = pgTable("audit_event", columns(), (t) => [
  index("audit_event_occurred_at_idx").on(t.occurredAt),
]);

/** The foreign key cascades instead of setting null. */
export const wrongForeignKey = pgTable(
  "audit_event",
  { ...columns(), actorId: uuid("actor_id").references(() => staffAccount.id, { onDelete: "cascade" }) },
  (t) => [index("audit_event_occurred_at_idx").on(t.occurredAt)],
).enableRLS();

/** An enum with a label the migrations do not have. */
export const auditOutcomeExtraLabel = pgEnum("audit_outcome", ["ok", "refused", "error"]);

/** A table the migrations never created. */
export const ghost = pgTable("ghost", { id: uuid().primaryKey() }).enableRLS();
