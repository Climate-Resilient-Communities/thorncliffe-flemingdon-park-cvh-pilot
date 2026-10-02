// Drift test fixture: a hand-written Drizzle schema that matches migrations/.
import { bigint, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const auditOutcome = pgEnum("audit_outcome", ["ok", "refused"]);

export const staffAccount = pgTable("staff_account", {
  id: uuid().primaryKey().defaultRandom(),
  username: text().notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export const auditEvent = pgTable(
  "audit_event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    actorId: uuid("actor_id").references(() => staffAccount.id, { onDelete: "set null" }),
    action: text().notNull(),
    outcome: auditOutcome().notNull().default("ok"),
    detail: jsonb(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_event_occurred_at_idx").on(t.occurredAt)],
).enableRLS();
