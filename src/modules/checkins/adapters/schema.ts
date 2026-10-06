// Drizzle tables of the checkins module (AD-2), written by hand to match db/migrations (20261006170000_checkin_request.sql); the drift test
// compares them. The grants (the app reads and adds rows and changes only what a round changes; the tally is its trigger's alone), the
// guards and the tally's trigger live only in the migration.
import { sql } from "drizzle-orm";
import { check, index, integer, pgPolicy, pgRole, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * alerting's alert, subscriptions' subscriber and places' building, named here only so the foreign keys below can be declared: Drizzle needs a
 * table object, and checkins may not import those modules' schemas (AD-2). Not exported.
 */
const alertKey = pgTable("alert", { id: uuid().primaryKey() });
const subscriberKey = pgTable("subscriber", { id: uuid().primaryKey() });
const buildingKey = pgTable("building", { rsn: text().primaryKey() });

/**
 * One requester in one round (E08 "Round"): a live row names its subscriber, the place and the method, never a phone number; `round_ref` is
 * a random UUID, the only name the round page and marks use. When the row leaves the round its outcome is recorded once and it becomes a
 * closed stub (no subscriber, no method), deleted 2 hours later. A drill or closed thread never gets a row (the migration's insert guard).
 */
export const checkin = pgTable(
  "checkin",
  {
    id: uuid().primaryKey(),
    roundRef: uuid("round_ref").notNull().defaultRandom(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alertKey.id),
    subscriberId: uuid("subscriber_id").references(() => subscriberKey.id, { onDelete: "cascade" }),
    rsn: text()
      .notNull()
      .references(() => buildingKey.rsn),
    floorId: uuid("floor_id").notNull(),
    method: text(),
    status: text().notNull().default("pending"),
    outcome: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    talliedAt: timestamp("tallied_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("checkin_round_ref_idx").on(t.roundRef),
    uniqueIndex("checkin_alert_subscriber_idx").on(t.alertId, t.subscriberId),
    index("checkin_subscriber_id_idx").on(t.subscriberId),
    index("checkin_rsn_idx").on(t.rsn),
    index("checkin_closed_at_idx").on(t.closedAt),
    check("checkin_round_ref_random", sql`substr(${t.roundRef}::text, 15, 1) = '4'`),
    check("checkin_method_known", sql`${t.method} is null or ${t.method} in ('call', 'text')`),
    check("checkin_status_known", sql`${t.status} in ('pending', 'done', 'not_reached', 'needs_help')`),
    check("checkin_outcome_known", sql`${t.outcome} is null or ${t.outcome} in ('done', 'not_reached', 'needs_help', 'withdrawn', 'unmarked')`),
    check(
      "checkin_outcome_of_mark",
      sql`${t.outcome} is null or (${t.status} = 'pending' and ${t.outcome} in ('withdrawn', 'unmarked')) or (${t.status} <> 'pending' and ${t.outcome} = ${t.status})`,
    ),
    check("checkin_tallied_with_outcome", sql`(${t.outcome} is null) = (${t.talliedAt} is null)`),
    check(
      "checkin_live_or_stub",
      sql`(${t.closedAt} is null and ${t.subscriberId} is not null and ${t.method} is not null) or (${t.closedAt} is not null and ${t.subscriberId} is null and ${t.method} is null and ${t.talliedAt} is not null)`,
    ),
    pgPolicy("checkin_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("checkin_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("checkin_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The round tally (E08 "Round tally"): counts per thread, building, floor and status, kept by the migration's trigger on `checkin` in the
 * same transaction. `requested` is cumulative; each row adds one outcome when it leaves the round. No identifier of anyone. The app reads it.
 */
export const checkinTally = pgTable(
  "checkin_tally",
  {
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alertKey.id),
    rsn: text().notNull(),
    floorId: uuid("floor_id").notNull(),
    status: text().notNull(),
    n: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.alertId, t.rsn, t.floorId, t.status] }),
    check("checkin_tally_status_known", sql`${t.status} in ('requested', 'done', 'not_reached', 'needs_help', 'withdrawn', 'unmarked')`),
    check("checkin_tally_n_positive", sql`${t.n} > 0`),
    pgPolicy("checkin_tally_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();
