// Drizzle tables of the subscriptions module (AD-2), written by hand to match db/migrations; the drift test compares them.
// The grants (select, insert and delete to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, index, pgPolicy, pgRole, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

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
