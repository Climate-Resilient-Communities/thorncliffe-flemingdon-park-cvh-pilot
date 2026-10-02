// Drizzle tables of the spend module (AD-2), written by hand to match db/migrations/20261002300000_spend_event.sql;
// the drift test compares them. The grants (select and insert to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, numeric, pgPolicy, pgRole, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

export const spendEvent = pgTable(
  "spend_event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().notNull(),
    purpose: text().notNull(),
    model: text().notNull(),
    releaseV: integer("release_v"),
    calls: integer().notNull().default(1),
    tokens: bigint({ mode: "number" }).notNull().default(0),
    tokensEstimated: boolean("tokens_estimated").notNull().default(false),
    ms: integer(),
    pricePerMillionTokensCad: numeric("price_per_million_tokens_cad"),
  },
  (t) => [
    index("spend_event_kind_at_idx").on(t.kind, t.at),
    check("spend_event_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("spend_event_purpose_format", sql`${t.purpose} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("spend_event_model_format", sql`${t.model} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`),
    check("spend_event_release_v_positive", sql`${t.releaseV} is null or ${t.releaseV} > 0`),
    check("spend_event_calls_positive", sql`${t.calls} >= 1`),
    check("spend_event_tokens_not_negative", sql`${t.tokens} >= 0`),
    check("spend_event_ms_not_negative", sql`${t.ms} is null or ${t.ms} >= 0`),
    check("spend_event_price_not_negative", sql`${t.pricePerMillionTokensCad} is null or ${t.pricePerMillionTokensCad} >= 0`),
    pgPolicy("spend_event_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("spend_event_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();
