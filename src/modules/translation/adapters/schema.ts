// Drizzle tables of the translation module (AD-2), written by hand to match
// db/migrations/20261003010000_translation_route_cache.sql; the drift test compares them. The grants, the deferred
// constraint trigger on translation_route (a language's route deadline is at most 30 s and its rows agree about its check)
// and the seed live only in the migration.
import { sql } from "drizzle-orm";
import { check, integer, pgPolicy, pgRole, pgTable, primaryKey, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

export const translationRoute = pgTable(
  "translation_route",
  {
    lang: text().notNull(),
    position: smallint().notNull(),
    model: text().notNull(),
    attemptTimeoutMs: integer("attempt_timeout_ms").notNull(),
    eldCode: text("eld_code"),
    script: text().notNull(),
    markerLetters: text("marker_letters").notNull().default(""),
    excludedLetters: text("excluded_letters").notNull().default(""),
    source: text().notNull().default("provisional"),
  },
  (t) => [
    primaryKey({ columns: [t.lang, t.position] }),
    unique("translation_route_lang_model_key").on(t.lang, t.model),
    check("translation_route_lang_valid", sql`${t.lang} in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')`),
    check("translation_route_position_range", sql`${t.position} between 1 and 9`),
    check("translation_route_model_format", sql`${t.model} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`),
    check("translation_route_attempt_timeout_valid", sql`${t.attemptTimeoutMs} between 1000 and 20000 and ${t.attemptTimeoutMs} % 1000 = 0`),
    check("translation_route_eld_code_format", sql`${t.eldCode} is null or ${t.eldCode} ~ '^[a-z]{2,3}$'`),
    check("translation_route_script_valid", sql`${t.script} in ('arabic', 'devanagari', 'bengali', 'gurmukhi', 'gujarati', 'tamil', 'greek', 'han', 'latin')`),
    check("translation_route_source_valid", sql`${t.source} in ('provisional', 'measured')`),
    pgPolicy("translation_route_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

export const translationCache = pgTable(
  "translation_cache",
  {
    sourceHash: text("source_hash").notNull(),
    lang: text().notNull(),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    checkVersion: text("check_version").notNull(),
    openccVersion: text("opencc_version").notNull().default(""),
    openccConfig: text("opencc_config").notNull().default(""),
    body: text().notNull(),
    status: text().notNull(),
    fromTextHash: text("from_text_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceHash, t.lang, t.modelId, t.promptVersion, t.checkVersion, t.openccVersion, t.openccConfig] }),
    check("translation_cache_source_hash_format", sql`${t.sourceHash} ~ '^[0-9a-f]{64}$'`),
    check("translation_cache_lang_valid", sql`${t.lang} in ('ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`),
    check("translation_cache_model_id_format", sql`${t.modelId} ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'`),
    check("translation_cache_versions_present", sql`${t.promptVersion} <> '' and ${t.checkVersion} <> ''`),
    check("translation_cache_body_present", sql`btrim(${t.body}) <> ''`),
    check("translation_cache_status_passing", sql`${t.status} in ('ok', 'script_converted')`),
    check(
      "translation_cache_converted_shape",
      sql`(${t.lang} = 'zh-Hant' and ${t.status} = 'script_converted' and ${t.openccVersion} <> '' and ${t.openccConfig} <> '' and ${t.fromTextHash} is not null and ${t.fromTextHash} ~ '^[0-9a-f]{64}$') or (${t.lang} <> 'zh-Hant' and ${t.status} = 'ok' and ${t.openccVersion} = '' and ${t.openccConfig} = '' and ${t.fromTextHash} is null)`,
    ),
    pgPolicy("translation_cache_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("translation_cache_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("translation_cache_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
