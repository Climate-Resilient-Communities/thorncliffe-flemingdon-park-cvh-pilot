// Drizzle tables of the alerting module (AD-2: only tables this module owns). Written by hand to
// match db/migrations/20261002250000_alert_lifecycle.sql; test/db/drift.db.test.ts compares them
// with the migrated database. The state-machine triggers, the grants (column-level updates for
// cvh_app, nothing for anyone else) and the nondrill_alert view live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  },
  (t) => [
    check("alert_status_valid", sql`${t.status} in ('open', 'closed')`),
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
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedVersion: integer("approved_version"),
    approvedHash: text("approved_hash"),
    webPublishedAt: timestamp("web_published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("alert_entry_kind_valid", sql`${t.kind} in ('ack', 'update', 'correction', 'withdrawal', 'final')`),
    check("alert_entry_status_valid", sql`${t.status} in ('draft', 'pending_approval', 'approved', 'discarded', 'superseded', 'published_system')`),
    check("alert_entry_phase_valid", sql`${t.phase} in ('problem', 'in_progress')`),
    check("alert_entry_text_valid", sql`btrim(${t.originalText}) <> '' and char_length(${t.originalText}) <= 600`),
    check("alert_entry_types_present", sql`cardinality(${t.types}) >= 1`),
    check("alert_entry_audience_valid", sql`jsonb_typeof(${t.audience}) = 'object' and ${t.audience} ->> 'scope' in ('neighbourhood', 'buildings')`),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.entryId, t.lang] }),
    check("alert_entry_translation_lang_valid", sql`${t.lang} in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`),
    check("alert_entry_translation_body_present", sql`btrim(${t.body}) <> ''`),
    check("alert_entry_translation_status_valid", sql`${t.status} in ('translated', 'fallback_en', 'script_converted')`),
    check("alert_entry_translation_source_hash_format", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("alert_entry_translation_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("alert_entry_translation_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("alert_entry_translation_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
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
