// Drizzle tables of the subscriptions module (AD-2), written by hand to match db/migrations; the drift test compares them.
// The grants (select, insert and delete to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, index, pgPolicy, pgRole, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be declared: Drizzle needs a table object, and subscriptions may not
 * import identity's schema (AD-2). Not exported; the real definition is src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

/**
 * One row per request a client was allowed in a window (S03.04, 20261002340000_search_log_rate_limit.sql): the scope and a
 * keyed hash of the client's address, never the address. Deleted after 24 hours (AD-13, AD-22).
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    scope: text().notNull(),
    clientHash: text("client_hash").notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rate_limit_client_idx").on(t.scope, t.clientHash, t.at),
    index("rate_limit_at_idx").on(t.at),
    check("rate_limit_scope_format", sql`${t.scope} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("rate_limit_client_hash_format", sql`${t.clientHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("rate_limit_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("rate_limit_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("rate_limit_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/**
 * The drill roster (S06.05, db/migrations/20261004110000_drill_roster.sql): the staff phones a drill is texted on. Personal data (AD-13), protected as
 * the on-call roster is: the number is read only by the ContactResolver's source and by the roster screen (masked), and goes into no log, audit
 * record or `delivery`. The app adds, changes (label, number, language) and deletes rows. `delivery_forget_recipient('roster')` (a trigger in the
 * migration) is its ON DELETE SET NULL, and the delivery insert guard refuses a drill text to anyone who is not a row of this table.
 */
export const drillRoster = pgTable(
  "drill_roster",
  {
    id: uuid().primaryKey(),
    label: text().notNull(),
    phone: text().notNull(),
    lang: text().notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => staffAccountKey.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drill_roster_phone_idx").on(t.phone),
    index("drill_roster_added_by_idx").on(t.addedBy),
    check("drill_roster_label_format", sql`btrim(${t.label}) <> '' and char_length(${t.label}) <= 40 and ${t.label} !~ '[[:cntrl:]]'`),
    check("drill_roster_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{9}$'`),
    check(
      "drill_roster_lang_valid",
      sql`${t.lang} in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`,
    ),
    pgPolicy("drill_roster_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("drill_roster_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("drill_roster_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
    pgPolicy("drill_roster_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();
