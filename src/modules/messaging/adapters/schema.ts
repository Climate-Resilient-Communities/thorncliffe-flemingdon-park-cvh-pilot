// Drizzle tables of the messaging module (AD-2), written by hand to match
// db/migrations/20261002220000_sms_test_send.sql; the drift test compares them.
// The grants live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, index, integer, pgPolicy, pgRole, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by the audit migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be declared: Drizzle needs
 * a table object, and messaging may not import identity (AD-2). Not exported; the real definition is
 * src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

/** The first-text spike's ledger (S01.15; E06 removes it): one claim per test text, taken before Twilio is called. */
export const smsTestSend = pgTable(
  "sms_test_send",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    requestId: uuid("request_id").notNull().unique(),
    staffAccountId: uuid("staff_account_id")
      .notNull()
      .references(() => staffAccountKey.id),
    numberHash: text("number_hash").notNull(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text().notNull().default("pending"),
    httpStatus: integer("http_status"),
    providerStatus: text("provider_status"),
    providerMessageId: text("provider_message_id"),
    providerErrorCode: integer("provider_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("sms_test_send_number_idx").on(t.numberHash, t.claimedAt),
    check("sms_test_send_number_hash_format", sql`${t.numberHash} ~ '^[0-9a-f]{64}$'`),
    check("sms_test_send_outcome", sql`${t.outcome} in ('pending', 'sent', 'failed', 'unknown')`),
    check("sms_test_send_http_status", sql`${t.httpStatus} is null or ${t.httpStatus} between 100 and 599`),
    check("sms_test_send_provider_status", sql`${t.providerStatus} is null or ${t.providerStatus} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("sms_test_send_message_id_format", sql`${t.providerMessageId} is null or ${t.providerMessageId} ~ '^(SM|MM)[0-9a-f]{32}$'`),
    check("sms_test_send_pending_has_no_answer", sql`${t.outcome} <> 'pending' or ${t.completedAt} is null`),
    pgPolicy("sms_test_send_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sms_test_send_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("sms_test_send_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
