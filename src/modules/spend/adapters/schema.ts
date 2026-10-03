// Drizzle tables of the spend module (AD-2), written by hand to match db/migrations/20261002300000_spend_event.sql and
// db/migrations/20261003400000_sms_spend.sql (a text message's estimate, the reconciliations, the actual prices and which actual retired
// which estimate); the drift test compares them. The grants, the functions and the triggers live only in the migrations.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, numeric, pgPolicy, pgRole, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
    // A text message's estimate (kind `sms`, S06.08): the delivery it was made for, its language, the alert entry (alerts only), whether
    // it went to the drill roster, its segments and the estimate in whole cents CAD. Null on the rows of every other kind.
    deliveryId: uuid("delivery_id"),
    lang: text(),
    entryId: uuid("entry_id"),
    isDrill: boolean("is_drill"),
    segments: integer(),
    costEstimateCents: integer("cost_estimate_cents"),
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
    check(
      "spend_event_sms_shape",
      sql`(${t.kind} = 'sms'
    and ${t.deliveryId} is not null and ${t.lang} is not null and ${t.isDrill} is not null
    and ${t.segments} is not null and ${t.segments} between 1 and 24
    and ${t.costEstimateCents} is not null and ${t.costEstimateCents} >= 0
    and ${t.purpose} in ('alert', 'transactional', 'campaign')
    and (${t.entryId} is not null) = (${t.purpose} = 'alert'))
  or (${t.kind} <> 'sms'
    and ${t.deliveryId} is null and ${t.lang} is null and ${t.entryId} is null and ${t.isDrill} is null
    and ${t.segments} is null and ${t.costEstimateCents} is null)`,
    ),
    check("spend_event_lang_format", sql`${t.lang} is null or ${t.lang} ~ '^[A-Za-z]{2,3}(-[A-Za-z]{2,8})?$'`),
    uniqueIndex("spend_event_delivery_id_idx").on(t.deliveryId).where(sql`${t.deliveryId} is not null`),
    index("spend_event_entry_id_idx").on(t.entryId).where(sql`${t.entryId} is not null`),
    pgPolicy("spend_event_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("spend_event_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * One reconciliation of the provider's prices (S06.08), by a stable id (`month:{YYYY-MM}`). Its interval is the Toronto calendar month
 * the id names, in UTC, and a check recomputes it. Pending until a listing has completed with every message priced, then complete for good.
 */
export const smsReconciliation = pgTable(
  "sms_reconciliation",
  {
    id: text().primaryKey(),
    intervalStart: timestamp("interval_start", { withTimezone: true }).notNull(),
    intervalEnd: timestamp("interval_end", { withTimezone: true }).notNull(),
    state: text().notNull().default("pending"),
    pendingReason: text("pending_reason"),
    attempts: integer().notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    usdToCadRate: numeric("usd_to_cad_rate"),
    messages: integer(),
    imported: integer(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("sms_reconciliation_id_month", sql`${t.id} ~ '^month:[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check(
      "sms_reconciliation_interval_exact",
      sql`case
      when ${t.id} ~ '^month:[0-9]{4}-(0[1-9]|1[0-2])$' then
        ${t.intervalStart} = (make_timestamp(substr(${t.id}, 7, 4)::int, substr(${t.id}, 12, 2)::int, 1, 0, 0, 0) at time zone 'America/Toronto')
        and ${t.intervalEnd} = ((make_timestamp(substr(${t.id}, 7, 4)::int, substr(${t.id}, 12, 2)::int, 1, 0, 0, 0) + interval '1 month') at time zone 'America/Toronto')
      else false
    end`,
    ),
    check("sms_reconciliation_state_valid", sql`${t.state} in ('pending', 'complete')`),
    check(
      "sms_reconciliation_reason_valid",
      sql`${t.pendingReason} is null
    or ${t.pendingReason} in ('listing_failed', 'cut_short', 'message_without_price', 'price_unusable', 'message_malformed')`,
    ),
    check(
      "sms_reconciliation_coherent",
      sql`(${t.state} = 'pending' and ${t.completedAt} is null and ${t.messages} is null and ${t.imported} is null and ${t.usdToCadRate} is null)
    or (${t.state} = 'complete' and ${t.completedAt} is not null and ${t.messages} is not null and ${t.imported} is not null and ${t.usdToCadRate} is not null and ${t.pendingReason} is null)`,
    ),
    check(
      "sms_reconciliation_counts",
      sql`${t.attempts} >= 0 and (${t.messages} is null or ${t.messages} >= 0) and (${t.imported} is null or (${t.imported} >= 0 and ${t.imported} <= ${t.messages}))`,
    ),
    check("sms_reconciliation_rate_positive", sql`${t.usdToCadRate} is null or ${t.usdToCadRate} > 0`),
    pgPolicy("sms_reconciliation_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sms_reconciliation_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("sms_reconciliation_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The price the provider billed for one message (S06.08), keyed by its MessageSid, unique across every reconciliation: as the provider
 * reported it, the rate it was converted at and the amount in thousandths of a cent CAD. Insert-only.
 */
export const smsActual = pgTable(
  "sms_actual",
  {
    messageSid: text("message_sid").primaryKey(),
    reconciliationId: text("reconciliation_id")
      .notNull()
      .references(() => smsReconciliation.id),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    priceText: text("price_text").notNull(),
    priceUnit: text("price_unit").notNull(),
    rate: numeric().notNull(),
    cadMillicents: bigint("cad_millicents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sms_actual_reconciliation_id_idx").on(t.reconciliationId),
    check("sms_actual_sid_format", sql`${t.messageSid} ~ '^(SM|MM)[0-9a-f]{32}$'`),
    check("sms_actual_price_format", sql`${t.priceText} ~ '^-?[0-9]{1,9}(\\.[0-9]{1,8})?$'`),
    check("sms_actual_unit_format", sql`${t.priceUnit} ~ '^[A-Z]{3}$'`),
    check("sms_actual_rate_positive", sql`${t.rate} > 0`),
    check("sms_actual_cad_not_negative", sql`${t.cadMillicents} >= 0`),
    pgPolicy("sms_actual_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sms_actual_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * Which actual retired which estimate (S06.08): an estimate is retired at most once (its id is the key), an actual retires at most one
 * estimate (its MessageSid is unique), and a row is never changed or removed.
 */
export const smsEstimateRetirement = pgTable(
  "sms_estimate_retirement",
  {
    estimateId: bigint("estimate_id", { mode: "number" })
      .primaryKey()
      .references(() => spendEvent.id),
    messageSid: text("message_sid")
      .notNull()
      .references(() => smsActual.messageSid),
    retiredAt: timestamp("retired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("sms_estimate_retirement_message_sid_key").on(t.messageSid),
    pgPolicy("sms_estimate_retirement_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sms_estimate_retirement_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();
