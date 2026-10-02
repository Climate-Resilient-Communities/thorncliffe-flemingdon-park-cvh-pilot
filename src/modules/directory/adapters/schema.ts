// Drizzle tables of the directory module (AD-2: only tables this module owns). Written by
// hand to match db/migrations; test/db/drift.db.test.ts compares them with the migrated database.
// Grants (select to cvh_app, none to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { boolean, check, date, doublePrecision, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/** Text key -> language -> text, e.g. {"title": {"en": "Power outage", "ur": "..."}}. */
export type ContentTexts = Record<string, Record<string, string>>;

/** Text key -> language -> where a loaded translation came from. */
export type ContentProvenance = Record<string, Record<string, Record<string, unknown>>>;

export const guide = pgTable(
  "guide",
  {
    id: text().primaryKey(),
    readMins: smallint("read_mins").notNull(),
    owner: text().notNull(),
    lastUpdated: date("last_updated", { mode: "string" }).notNull(),
    englishReviewer: text("english_reviewer").notNull(),
    englishReviewedOn: date("english_reviewed_on", { mode: "string" }).notNull(),
    texts: jsonb().$type<ContentTexts>().notNull(),
    translations: jsonb().$type<ContentProvenance>().notNull().default({}),
  },
  () => [pgPolicy("guide_app_select", { for: "select", to: cvhApp, using: sql`true` })],
).enableRLS();

export const essentialNumber = pgTable(
  "essential_number",
  {
    id: text().primaryKey(),
    sortOrder: smallint("sort_order").notNull(),
    number: text().notNull(),
    emergency: boolean().notNull().default(false),
    owner: text().notNull(),
    lastUpdated: date("last_updated", { mode: "string" }).notNull(),
    englishReviewer: text("english_reviewer").notNull(),
    englishReviewedOn: date("english_reviewed_on", { mode: "string" }).notNull(),
    lastChecked: date("last_checked", { mode: "string" }).notNull(),
    texts: jsonb().$type<ContentTexts>().notNull(),
    translations: jsonb().$type<ContentProvenance>().notNull().default({}),
  },
  () => [pgPolicy("essential_number_app_select", { for: "select", to: cvhApp, using: sql`true` })],
).enableRLS();

// ---------------------------------------------------------------- the provider catalogue (S02.04)
/** A text key -> language -> text map, as the guides keep theirs ({"services": {"en": "...", "ur": "..."}}). */
export type ProviderTexts = Record<string, Record<string, string>>;

export interface ProviderContact {
  phone: string[];
  email: string[];
  social: string[];
  web: string[];
}

export interface ProviderSubcategory {
  name: string;
  labels: Record<string, string>;
}

export const provider = pgTable(
  "provider",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    subcategories: jsonb().$type<ProviderSubcategory[]>().notNull().default([]),
    contact: jsonb().$type<ProviderContact>().notNull().default(sql`'{}'::jsonb`),
    texts: jsonb().$type<ProviderTexts>().notNull(),
    translations: jsonb().$type<ContentProvenance>().notNull().default({}),
    sourceNotes: jsonb("source_notes").$type<string[]>().notNull().default([]),
    inCatalogue: boolean("in_catalogue").notNull().default(true),
    published: boolean().notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastConfirmed: date("last_confirmed", { mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("provider_id_format", sql`${t.id} ~ '^[A-Z][0-9]{3,6}$'`),
    check("provider_published_after_confirmation", sql`not ${t.published} or ${t.lastConfirmed} is not null`),
    check("provider_published_in_catalogue", sql`not ${t.published} or ${t.inCatalogue}`),
    check("provider_published_at_when_published", sql`${t.published} = (${t.publishedAt} is not null)`),
    pgPolicy("provider_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("provider_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const providerLocation = pgTable(
  "provider_location",
  {
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id),
    seq: smallint().notNull().default(0),
    street: text().notNull(),
    city: text().notNull(),
    postal: text(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.seq] }),
    check("provider_location_in_toronto", sql`${table.lat} between 43.58 and 43.86 and ${table.lng} between -79.64 and -79.11`),
    pgPolicy("provider_location_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

export const category = pgTable(
  "category",
  {
    id: text().primaryKey(),
    name: text().notNull().unique(),
    sortOrder: smallint("sort_order").notNull(),
    labels: jsonb().$type<Record<string, string>>().notNull(),
    translations: jsonb().$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    inCatalogue: boolean("in_catalogue").notNull().default(true),
  },
  () => [pgPolicy("category_app_select", { for: "select", to: cvhApp, using: sql`true` })],
).enableRLS();

export const providerCategory = pgTable(
  "provider_category",
  {
    providerId: text("provider_id")
      .notNull()
      .references(() => provider.id),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id),
  },
  (table) => [
    primaryKey({ columns: [table.providerId, table.categoryId] }),
    index("provider_category_category_idx").on(table.categoryId),
    pgPolicy("provider_category_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

// ---------------------------------------------------------------- the directory release (S02.05)
/** A language's file in a release: where it is, its hash and size, and when it reached Storage (null until it did). */
export interface ReleaseFileEntry {
  path: string;
  sha256: string;
  bytes: number;
  stored_at: string | null;
}

export const directoryRelease = pgTable(
  "directory_release",
  {
    number: integer().primaryKey(),
    status: text().$type<"building" | "complete" | "failed">().notNull(),
    catalogueHash: text("catalogue_hash").notNull(),
    gitCommit: text("git_commit"),
    startedBy: uuid("started_by"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    counts: jsonb().$type<Record<string, number>>().notNull(),
    report: jsonb().$type<Record<string, unknown>>().notNull(),
    files: jsonb().$type<Record<string, ReleaseFileEntry>>().notNull(),
    staged: jsonb().$type<Record<string, string> | null>(),
    search: jsonb().$type<Record<string, unknown> | null>(),
    attempts: smallint().notNull().default(1),
    leaseToken: uuid("lease_token"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    failure: text(),
    isCurrent: boolean("is_current").notNull().default(false),
    currentSince: timestamp("current_since", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("directory_release_one_current").on(t.isCurrent).where(sql`${t.isCurrent}`),
    index("directory_release_building_idx").on(t.number).where(sql`${t.status} = 'building'`),
    check("directory_release_number_positive", sql`${t.number} > 0`),
    check("directory_release_status", sql`${t.status} in ('building', 'complete', 'failed')`),
    check("directory_release_catalogue_hash", sql`${t.catalogueHash} ~ '^[0-9a-f]{64}$'`),
    check("directory_release_git_commit", sql`${t.gitCommit} is null or ${t.gitCommit} ~ '^[0-9a-f]{7,40}$'`),
    check("directory_release_counts_object", sql`jsonb_typeof(${t.counts}) = 'object'`),
    check("directory_release_report_object", sql`jsonb_typeof(${t.report}) = 'object'`),
    check("directory_release_files_object", sql`jsonb_typeof(${t.files}) = 'object'`),
    check("directory_release_staged_object", sql`${t.staged} is null or jsonb_typeof(${t.staged}) = 'object'`),
    check("directory_release_search_object", sql`${t.search} is null or jsonb_typeof(${t.search}) = 'object'`),
    check("directory_release_attempts", sql`${t.attempts} between 1 and 3`),
    check("directory_release_failure_code", sql`${t.failure} is null or ${t.failure} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("directory_release_published_when_complete", sql`(${t.status} = 'complete') = (${t.publishedAt} is not null)`),
    check("directory_release_failure_when_failed", sql`(${t.status} = 'failed') = (${t.failure} is not null)`),
    check("directory_release_current_is_complete", sql`not ${t.isCurrent} or ${t.status} = 'complete'`),
    check("directory_release_current_since_when_current", sql`not ${t.isCurrent} or ${t.currentSince} is not null`),
    check("directory_release_staged_only_while_building", sql`${t.staged} is null or ${t.status} = 'building'`),
    check("directory_release_lease_pair", sql`(${t.leaseToken} is null) = (${t.leaseUntil} is null)`),
    pgPolicy("directory_release_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("directory_release_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("directory_release_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
