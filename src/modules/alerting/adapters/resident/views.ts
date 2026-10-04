// The only alert relations a resident query may name (AD-6, S04.08): the three views of
// db/migrations/20261003510000_resident_alert_views.sql, each of which selects from `nondrill_alert`; the entry
// view also reads the slug from `alert`, only for a thread that its join to `nondrill_alert` has already shown is not a drill. They are declared `existing()`: Drizzle never creates or changes them, the migration does, and
// test/db/drift.db.test.ts reads only `adapters/schema.ts`, where the tables are.
//
// The files of this directory may import this one and not `../schema` (the dependency rule `resident-queries-read-nondrill-only`),
// and may not write the name of any other alert relation in a string (the ESLint rule of the same name, eslint.config.mjs), so a
// query that would read a drill's thread, a draft or an unpublished entry cannot be written here without the checks failing.
import { boolean, jsonb, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** The thread: open or closed, never a drill. (S04.03's view, unchanged: the slug is on the entry view below.) */
export const nondrillAlert = pgView("nondrill_alert", {
  id: uuid().notNull(),
  status: text().notNull(),
  closedReason: text("closed_reason"),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}).existing();

/** (v2: S04.08's `nondrill_alert_entry` stays as it was for the previous release; this one appends `supersedes_id`.) The web-published entries of those threads, with what a resident may read of each and the thread's address (`slug`). */
export const nondrillAlertEntryV2 = pgView("nondrill_alert_entry_v2", {
  id: uuid().notNull(),
  alertId: uuid("alert_id").notNull(),
  slug: text().notNull(),
  kind: text().notNull(),
  phase: text().notNull(),
  types: text().array().notNull(),
  audience: jsonb().notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  originalText: text("original_text").notNull(),
  webPublishedAt: timestamp("web_published_at", { withTimezone: true }).notNull(),
  verified: boolean().notNull(),
  superseded: boolean().notNull(),
  /** S05.02: the entry a correction or a withdrawal replaces; null for every other entry. */
  supersedesId: uuid("supersedes_id"),
}).existing();

/** (v3, S08.02: v2 stays as it was for the previous release; this one appends `attributed_rsn`.) The same entries, with the building an ambassador's post is attributed to. */
export const nondrillAlertEntryV3 = pgView("nondrill_alert_entry_v3", {
  id: uuid().notNull(),
  alertId: uuid("alert_id").notNull(),
  slug: text().notNull(),
  kind: text().notNull(),
  phase: text().notNull(),
  types: text().array().notNull(),
  audience: jsonb().notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  originalText: text("original_text").notNull(),
  webPublishedAt: timestamp("web_published_at", { withTimezone: true }).notNull(),
  verified: boolean().notNull(),
  superseded: boolean().notNull(),
  supersedesId: uuid("supersedes_id"),
  /** S08.02: the building (rsn) an ambassador's post is attributed to ("Building ambassador, {building}"); null for the Hub's own entries. */
  attributedRsn: text("attributed_rsn"),
}).existing();

/** The frozen web text of each of those entries, one row per translated language. */
export const nondrillAlertEntryTranslation = pgView("nondrill_alert_entry_translation", {
  entryId: uuid("entry_id").notNull(),
  lang: text().notNull(),
  body: text().notNull(),
  machine: boolean().notNull(),
  model: text(),
  status: text().notNull(),
  sourceHash: text("source_hash").notNull(),
}).existing();
