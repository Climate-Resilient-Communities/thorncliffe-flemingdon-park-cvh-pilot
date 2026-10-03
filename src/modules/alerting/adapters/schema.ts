// Drizzle tables of the alerting module (AD-2: only tables this module owns). Written by hand to
// match db/migrations/20261002250000_alert_lifecycle.sql (and the later migrations that add to them);
// test/db/drift.db.test.ts compares them with the migrated database. The state-machine triggers, the
// grants (column-level updates for cvh_app, nothing for anyone else), the nondrill_alert view and the
// approval timing views (S04.07) live only in the migrations.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign keys below can be declared: Drizzle
 * needs a table object, and alerting may not import identity's schema (AD-2). Not exported.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

export const alert = pgTable(
  "alert",
  {
    id: uuid().primaryKey(),
    status: text().notNull().default("open"),
    closedReason: text("closed_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** Set at creation, never changes (a trigger refuses it). */
    isDrill: boolean("is_drill").notNull(),
    /** When the first report reached the Hub, entered by staff and never later than the thread's creation. */
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** The thread's short public slug (S04.05): the texts link to `/a/{slug}`; made at creation, never changes (a trigger refuses it). */
    slug: text(),
  },
  (t) => [
    check("alert_status_valid", sql`${t.status} in ('open', 'closed')`),
    check("alert_slug_valid", sql`${t.slug} is not null and ${t.slug} ~ '^[a-z0-9]{6,16}$'`),
    uniqueIndex("alert_slug_key").on(t.slug),
    check("alert_closed_reason_valid", sql`${t.closedReason} is null or ${t.closedReason} in ('resolved', 'expired', 'withdrawn')`),
    check(
      "alert_closed_consistent",
      sql`(${t.status} = 'open' and ${t.closedReason} is null and ${t.closedAt} is null) or (${t.status} = 'closed' and ${t.closedReason} is not null and ${t.closedAt} is not null)`,
    ),
    check("alert_reported_not_after_created", sql`${t.reportedAt} <= ${t.createdAt}`),
    foreignKey({ name: "alert_created_by_fkey", columns: [t.createdBy], foreignColumns: [staffAccountKey.id] }),
    index("alert_created_by_idx").on(t.createdBy),
    pgPolicy("alert_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("alert_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("alert_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const alertEntry = pgTable(
  "alert_entry",
  {
    id: uuid().primaryKey(),
    alertId: uuid("alert_id")
      .notNull()
      .references(() => alert.id),
    kind: text().notNull(),
    status: text().notNull().default("draft"),
    authorId: uuid("author_id").notNull(),
    /** The author and every account that changed the entry's content; written only by the trigger. */
    editorIds: uuid("editor_ids").array().notNull(),
    originalText: text("original_text").notNull(),
    types: text().array().notNull(),
    audience: jsonb().notNull(),
    phase: text().notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    /** Raised by one at each submit, never lowered, kept when the entry returns to draft. */
    version: integer().notNull().default(0),
    contentHash: text("content_hash"),
    smsBodies: jsonb("sms_bodies"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    returnedFor: text("returned_for"),
    /** S04.07: the note an approver wrote when they sent the entry back to its author; exists exactly while `returnedFor` is `return` (db/migrations/20261003300000_alert_approval.sql). */
    returnedNote: text("returned_note"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedVersion: integer("approved_version"),
    approvedHash: text("approved_hash"),
    webPublishedAt: timestamp("web_published_at", { withTimezone: true }),
    /** S04.05: the open, non-drill thread this entry may duplicate, worked out at submit and frozen with it; advisory, not hashed. */
    possibleDuplicateOf: uuid("possible_duplicate_of").references(() => alert.id),
    /** S04.05: how the author chose the valid-until, "until resolved" or a date and time; the composer opens on it. */
    validUntilMode: text("valid_until_mode").notNull().default("at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("alert_entry_duplicate_not_self", sql`${t.possibleDuplicateOf} is null or ${t.possibleDuplicateOf} <> ${t.alertId}`),
    check("alert_entry_draft_no_duplicate", sql`${t.status} <> 'draft' or ${t.possibleDuplicateOf} is null`),
    check("alert_entry_valid_until_mode_valid", sql`${t.validUntilMode} in ('at', 'resolved')`),
    index("alert_entry_possible_duplicate_of_idx").on(t.possibleDuplicateOf),
    check("alert_entry_kind_valid", sql`${t.kind} in ('ack', 'update', 'correction', 'withdrawal', 'final')`),
    check("alert_entry_status_valid", sql`${t.status} in ('draft', 'pending_approval', 'approved', 'discarded', 'superseded', 'published_system')`),
    check("alert_entry_phase_valid", sql`${t.phase} in ('problem', 'in_progress')`),
    check("alert_entry_text_valid", sql`btrim(${t.originalText}) <> '' and char_length(${t.originalText}) <= 600`),
    check("alert_entry_types_present", sql`cardinality(${t.types}) >= 1`),
    check("alert_entry_audience_valid", sql`jsonb_typeof(${t.audience}) = 'object' and ${t.audience} ->> 'scope' in ('neighbourhood', 'buildings')`),
    // S04.04 (db/migrations/20261002290000_alert_audience_shape.sql): the shape of the one Audience value.
    check(
      "alert_entry_audience_shape",
      sql`(jsonb_typeof(${t.audience} -> 'groups') = 'array' and jsonb_typeof(${t.audience} -> 'types') = 'array' and jsonb_array_length(${t.audience} -> 'types') >= 1 and (${t.audience} -> 'types') @> to_jsonb(${t.types}) and to_jsonb(${t.types}) @> (${t.audience} -> 'types') and not jsonb_path_exists(${t.audience}, '$.groups[*] ? (@.type() != "string")') and not jsonb_path_exists(${t.audience}, '$.types[*] ? (@.type() != "string")') and not jsonb_path_exists(${t.audience}, '$.neighbourhood_ids[*] ? (@.type() != "string")') and not jsonb_path_exists(${t.audience}, '$.buildings[*] ? (!exists(@.floors) || (@.floors.type() != "null" && (@.floors.type() != "array" || @.floors.size() == 0 || exists(@.floors[*] ? (@.type() != "string")))))') and ((${t.audience} ->> 'scope' = 'neighbourhood' and jsonb_typeof(${t.audience} -> 'neighbourhood_ids') = 'array' and jsonb_array_length(${t.audience} -> 'neighbourhood_ids') >= 1) or (${t.audience} ->> 'scope' = 'buildings' and jsonb_typeof(${t.audience} -> 'buildings') = 'array' and jsonb_array_length(${t.audience} -> 'buildings') >= 1))) is true`,
    ),
    check("alert_entry_author_is_editor", sql`${t.authorId} = any (${t.editorIds})`),
    check("alert_entry_version_non_negative", sql`${t.version} >= 0`),
    check("alert_entry_hash_format", sql`${t.contentHash} is null or ${t.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("alert_entry_approved_hash_format", sql`${t.approvedHash} is null or ${t.approvedHash} ~ '^[0-9a-f]{64}$'`),
    check("alert_entry_sms_bodies_valid", sql`${t.smsBodies} is null or jsonb_typeof(${t.smsBodies}) = 'object'`),
    check("alert_entry_returned_for_valid", sql`${t.returnedFor} is null or ${t.returnedFor} in ('edit', 'return', 'retranslate')`),
    check("alert_entry_draft_unfrozen", sql`${t.status} <> 'draft' or (${t.contentHash} is null and ${t.smsBodies} is null and ${t.submittedAt} is null)`),
    check(
      "alert_entry_frozen_complete",
      sql`${t.status} not in ('pending_approval', 'approved', 'superseded') or (${t.contentHash} is not null and ${t.smsBodies} is not null and ${t.submittedAt} is not null and ${t.version} > 0)`,
    ),
    check(
      "alert_entry_approval_complete",
      sql`(${t.approvedBy} is null) = (${t.approvedAt} is null) and (${t.approvedBy} is null) = (${t.approvedVersion} is null) and (${t.approvedBy} is null) = (${t.approvedHash} is null)`,
    ),
    check("alert_entry_approved_has_approval", sql`${t.status} <> 'approved' or (${t.approvedBy} is not null and ${t.webPublishedAt} is not null)`),
    check("alert_entry_unapproved_has_none", sql`${t.status} not in ('draft', 'pending_approval', 'discarded') or ${t.approvedBy} is null`),
    check("alert_entry_returned_note_valid", sql`${t.returnedNote} is null or (btrim(${t.returnedNote}) <> '' and char_length(${t.returnedNote}) <= 500)`),
    check("alert_entry_return_has_note", sql`((${t.returnedFor} = 'return') is true) = (${t.returnedNote} is not null)`),
    check("alert_entry_returned_only_in_draft", sql`${t.status} not in ('pending_approval', 'approved') or ${t.returnedFor} is null`),
    foreignKey({ name: "alert_entry_author_id_fkey", columns: [t.authorId], foreignColumns: [staffAccountKey.id] }),
    foreignKey({ name: "alert_entry_approved_by_fkey", columns: [t.approvedBy], foreignColumns: [staffAccountKey.id] }),
    index("alert_entry_alert_id_idx").on(t.alertId),
    index("alert_entry_author_id_idx").on(t.authorId),
    index("alert_entry_approved_by_idx").on(t.approvedBy),
    pgPolicy("alert_entry_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("alert_entry_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("alert_entry_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const alertEntryTranslation = pgTable(
  "alert_entry_translation",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => alertEntry.id),
    lang: text().notNull(),
    body: text().notNull(),
    machine: boolean().notNull().default(true),
    model: text(),
    status: text().notNull(),
    sourceHash: text("source_hash").notNull(),
    /** zh-Hant only (S04.05): the zh text's hash, OpenCC's version and configuration, kept beside the converted text. */
    conversion: jsonb(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.lang] }),
    check(
      "alert_entry_translation_conversion_shape",
      sql`((${t.status} = 'script_converted') = (${t.conversion} is not null) and (${t.conversion} is null or (jsonb_typeof(${t.conversion}) = 'object' and ${t.conversion} ->> 'from' = 'zh' and ${t.conversion} ->> 'from_text_hash' ~ '^[0-9a-f]{64}$' and btrim(coalesce(${t.conversion} ->> 'opencc_version', '')) <> '' and btrim(coalesce(${t.conversion} ->> 'config', '')) <> ''))) is true`,
    ),
    check(
      "alert_entry_translation_status_consistent",
      sql`(${t.status} = 'fallback_en' and not ${t.machine} and ${t.model} is null) or (${t.status} in ('translated', 'script_converted') and ${t.machine} and ${t.model} is not null)`,
    ),
    check("alert_entry_translation_lang_valid", sql`${t.lang} in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`),
    check("alert_entry_translation_body_present", sql`btrim(${t.body}) <> ''`),
    check("alert_entry_translation_status_valid", sql`${t.status} in ('translated', 'fallback_en', 'script_converted')`),
    check("alert_entry_translation_source_hash_format", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("alert_entry_translation_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("alert_entry_translation_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("alert_entry_translation_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/**
 * One row per press of Submit (or of "Try translation again", S04.05), keyed by the browser's idempotency key. It makes a submit
 * whose outcome the browser did not see recoverable (running, committed, failed), lets only one attempt run per entry, and holds
 * each language's progress while the translation runs outside any lock. The triggers and grants live only in the migration.
 */
export const alertSubmitAttempt = pgTable(
  "alert_submit_attempt",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => alertEntry.id),
    key: text().notNull(),
    kind: text().notNull().default("submit"),
    state: text().notNull().default("running"),
    actorId: uuid("actor_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** The longest route deadline plus 5 seconds, in milliseconds. */
    budgetMs: integer("budget_ms"),
    /** Each language's result as it settles. */
    progress: jsonb().notNull().default(sql`'{}'::jsonb`),
    /** Why a failed attempt failed: a refusal code, never text. */
    outcome: text(),
    resultVersion: integer("result_version"),
    resultHash: text("result_hash"),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.key] }),
    check("alert_submit_attempt_key_format", sql`${t.key} ~ '^[A-Za-z0-9_-]{16,64}$'`),
    check("alert_submit_attempt_kind_valid", sql`${t.kind} in ('submit', 'retranslate')`),
    check("alert_submit_attempt_state_valid", sql`${t.state} in ('running', 'committed', 'failed')`),
    check("alert_submit_attempt_finished_consistent", sql`(${t.state} = 'running') = (${t.finishedAt} is null)`),
    check("alert_submit_attempt_outcome_consistent", sql`(${t.state} = 'failed') = (${t.outcome} is not null)`),
    check("alert_submit_attempt_outcome_format", sql`${t.outcome} is null or ${t.outcome} ~ '^[A-Z][A-Z0-9_]{2,40}$'`),
    check("alert_submit_attempt_result_consistent", sql`(${t.state} = 'committed') = (${t.resultVersion} is not null) and (${t.resultVersion} is null) = (${t.resultHash} is null)`),
    check("alert_submit_attempt_hash_format", sql`${t.resultHash} is null or ${t.resultHash} ~ '^[0-9a-f]{64}$'`),
    check("alert_submit_attempt_version_positive", sql`${t.resultVersion} is null or ${t.resultVersion} > 0`),
    check("alert_submit_attempt_budget_positive", sql`${t.budgetMs} is null or ${t.budgetMs} > 0`),
    check("alert_submit_attempt_progress_object", sql`jsonb_typeof(${t.progress}) = 'object'`),
    foreignKey({ name: "alert_submit_attempt_actor_id_fkey", columns: [t.actorId], foreignColumns: [staffAccountKey.id] }),
    uniqueIndex("alert_submit_attempt_one_running").on(t.entryId).where(sql`${t.state} = 'running'`),
    index("alert_submit_attempt_actor_id_idx").on(t.actorId),
    pgPolicy("alert_submit_attempt_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("alert_submit_attempt_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("alert_submit_attempt_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const feedVersion = pgTable(
  "feed_version",
  {
    id: smallint().primaryKey().default(1),
    version: bigint({ mode: "number" }).notNull().default(0),
  },
  (t) => [
    check("feed_version_single_row", sql`${t.id} = 1`),
    check("feed_version_non_negative", sql`${t.version} >= 0`),
    pgPolicy("feed_version_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("feed_version_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
