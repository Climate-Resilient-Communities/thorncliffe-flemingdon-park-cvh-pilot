// Drizzle tables of the directory module (AD-2: only tables this module owns). Written by
// hand to match db/migrations; test/db/drift.db.test.ts compares them with the migrated database.
// Grants (select to cvh_app, none to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { boolean, date, jsonb, pgPolicy, pgRole, pgTable, smallint, text } from "drizzle-orm/pg-core";

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
