// Drizzle tables of the messaging module (AD-2), written by hand to match
// db/migrations/20261002220000_sms_test_send.sql (the first-text spike's ledger), db/migrations/20261003100000_delivery_outbox.sql
// (the outbox), db/migrations/20261003200000_dispatcher.sql (the sender lease, the pause switch and the claim order) and
// db/migrations/20261003260000_messaging_pause.sql (the app's update of the pause); the drift test compares them.
// The grants, the functions and the triggers live only in the migrations.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgPolicy, pgRole, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

/**
 * alerting's alert_entry, named here only so the foreign key below can be declared: Drizzle needs a table object, and
 * messaging may not import alerting (AD-2). Not exported; the real definition is src/modules/alerting/adapters/schema.ts.
 */
const alertEntryKey = pgTable("alert_entry", { id: uuid().primaryKey() });

/**
 * The outbox (S06.01, AD-8): one row per text to one recipient, written before it is sent and never holding a phone
 * number. The triggers (the transition table, the frozen columns, the alert, transactional and campaign insert rules, the
 * forgetting of a deleted recipient), the functions and the grants live only in the migration.
 */
export const delivery = pgTable(
  "delivery",
  {
    id: uuid().primaryKey(),
    kind: text().notNull(),
    recipientKind: text("recipient_kind").notNull(),
    /** The id of the recipient in the table `recipientKind` names (so not a foreign key); null once the recipient was deleted. */
    recipientId: uuid("recipient_id"),
    entryId: uuid("entry_id").references(() => alertEntryKey.id),
    campaignId: uuid("campaign_id"),
    createdByModule: text("created_by_module").notNull(),
    purpose: text(),
    channel: text().notNull().default("sms"),
    lang: text().notNull(),
    body: text().notNull(),
    segments: integer().notNull(),
    costEstimateCents: integer("cost_estimate_cents").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    callbackRef: uuid("callback_ref").notNull().defaultRandom(),
    state: text().notNull().default("queued"),
    attempts: integer().notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    sendBy: timestamp("send_by", { withTimezone: true }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimedBy: text("claimed_by"),
    claimToken: uuid("claim_token"),
    handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    providerMessageId: text("provider_message_id"),
    providerErrorCode: integer("provider_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** The claim order as one number (S06.02), set by the insert trigger from the entry's frozen content: see `delivery_claim_rank()`. */
    claimRank: smallint("claim_rank").notNull().default(5),
  },
  (t) => [
    unique("delivery_idempotency_key_unique").on(t.idempotencyKey),
    unique("delivery_callback_ref_unique").on(t.callbackRef),
    check("delivery_kind_valid", sql`${t.kind} in ('alert', 'transactional', 'campaign')`),
    check("delivery_recipient_kind_valid", sql`${t.recipientKind} in ('subscriber', 'pending_signup', 'roster', 'staff', 'oncall', 'inbound_reply')`),
    check("delivery_module_valid", sql`${t.createdByModule} in ('alerting', 'subscriptions', 'checkins', 'ops')`),
    check("delivery_channel_valid", sql`${t.channel} = 'sms'`),
    check(
      "delivery_lang_valid",
      sql`${t.lang} in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`,
    ),
    check("delivery_body_valid", sql`btrim(${t.body}) <> '' and char_length(${t.body}) <= 1600`),
    check("delivery_segments_valid", sql`${t.segments} between 1 and 24`),
    check("delivery_cost_valid", sql`${t.costEstimateCents} >= 0`),
    check("delivery_key_format", sql`${t.idempotencyKey} ~ '^[A-Za-z0-9._:-]{1,200}$'`),
    check("delivery_purpose_format", sql`${t.purpose} is null or ${t.purpose} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check(
      "delivery_state_valid",
      sql`${t.state} in ('queued', 'claimed', 'submitted', 'unknown', 'delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env')`,
    ),
    check("delivery_attempts_valid", sql`${t.attempts} between 0 and 3`),
    check("delivery_claimed_by_format", sql`${t.claimedBy} is null or ${t.claimedBy} ~ '^[A-Za-z0-9._:-]{1,64}$'`),
    check("delivery_provider_message_id_format", sql`${t.providerMessageId} is null or ${t.providerMessageId} ~ '^(SM|MM)[0-9a-f]{32}$'`),
    check("delivery_provider_error_code_valid", sql`${t.providerErrorCode} is null or ${t.providerErrorCode} between 1 and 99999`),
    check(
      "delivery_kind_shape",
      sql`(${t.kind} = 'alert' and ${t.entryId} is not null and ${t.campaignId} is null and ${t.purpose} is null
        and ${t.createdByModule} = 'alerting' and ${t.recipientKind} in ('subscriber', 'roster'))
        or (${t.kind} = 'transactional' and ${t.entryId} is null and ${t.campaignId} is null and ${t.purpose} is not null and ${t.sendBy} is not null)
        or (${t.kind} = 'campaign' and ${t.entryId} is null and ${t.campaignId} is not null and ${t.purpose} is not null and ${t.createdByModule} = 'subscriptions'
        and ${t.recipientKind} = 'subscriber')`,
    ),
    check("delivery_send_by_after_creation", sql`${t.sendBy} is null or ${t.sendBy} > ${t.createdAt}`),
    check(
      "delivery_claim_coherent",
      sql`(${t.state} = 'claimed' and ${t.claimedAt} is not null and ${t.claimedBy} is not null and ${t.claimToken} is not null)
        or (${t.state} = 'queued' and ${t.claimedAt} is null and ${t.claimedBy} is null and ${t.claimToken} is null and ${t.handedOffAt} is null and ${t.providerMessageId} is null)
        or ${t.state} not in ('claimed', 'queued')`,
    ),
    check("delivery_handed_off_was_claimed", sql`${t.handedOffAt} is null or ${t.claimedAt} is not null`),
    check("delivery_in_flight_has_provider_id", sql`${t.state} not in ('submitted', 'delivered', 'undelivered') or ${t.providerMessageId} is not null`),
    check(
      "delivery_completed_when_terminal",
      sql`(${t.state} in ('delivered', 'undelivered', 'failed', 'cancelled', 'skipped', 'skipped_env')) = (${t.completedAt} is not null)`,
    ),
    index("delivery_entry_id_idx").on(t.entryId).where(sql`${t.entryId} is not null`),
    index("delivery_recipient_idx").on(t.recipientKind, t.recipientId).where(sql`${t.recipientId} is not null`),
    index("delivery_unresolved_idx").on(t.state, t.dueAt).where(sql`${t.state} in ('queued', 'claimed', 'submitted', 'unknown')`),
    check("delivery_claim_rank_valid", sql`${t.claimRank} between 0 and 5`),
    index("delivery_claim_idx").on(t.claimRank, t.createdAt, t.id).where(sql`${t.state} = 'queued'`),
    pgPolicy("delivery_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("delivery_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("delivery_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The sender lease (S06.02, AD-8): the one row that decides which dispatcher sends. A run takes it by a conditional update
 * once the previous lease has expired; every renewal, claim and hand-off compares `token = mine and expires_at > now()`.
 * `pacedUntil` carries the shared send pace to the next holder. The row is made by the migration; the app only updates it.
 */
export const dispatcherLease = pgTable(
  "dispatcher_lease",
  {
    id: smallint().primaryKey().default(1),
    token: uuid().notNull(),
    holder: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull(),
    pacedUntil: timestamp("paced_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("dispatcher_lease_single_row", sql`${t.id} = 1`),
    check("dispatcher_lease_holder_format", sql`${t.holder} ~ '^[A-Za-z0-9._:-]{1,64}$'`),
    pgPolicy("dispatcher_lease_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("dispatcher_lease_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The pause switch (S06.02 reads it, S06.06 sets it, audited): one row. While `paused`, nothing the pause applies to is claimed
 * or handed off; on-call texts are exempt. A missing row reads as paused. `handedOffAtPause` is the count of texts already handed to
 * the provider, among those of the alerts and campaigns the pause holds, taken in the transaction that set the pause.
 */
export const messagingControl = pgTable(
  "messaging_control",
  {
    id: smallint().primaryKey().default(1),
    paused: boolean().notNull().default(false),
    pausedBy: uuid("paused_by").references(() => staffAccountKey.id),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    reason: text(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    handedOffAtPause: integer("handed_off_at_pause"),
  },
  (t) => [
    index("messaging_control_paused_by_idx").on(t.pausedBy),
    check("messaging_control_single_row", sql`${t.id} = 1`),
    check("messaging_control_reason_length", sql`${t.reason} is null or (btrim(${t.reason}) <> '' and char_length(${t.reason}) <= 500)`),
    check("messaging_control_pause_stated", sql`not ${t.paused} or (${t.pausedBy} is not null and ${t.pausedAt} is not null and ${t.reason} is not null)`),
    check("messaging_control_handed_off_valid", sql`${t.handedOffAtPause} is null or ${t.handedOffAtPause} >= 0`),
    pgPolicy("messaging_control_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("messaging_control_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
