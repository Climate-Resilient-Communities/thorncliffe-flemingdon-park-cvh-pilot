// Drizzle tables of the subscriptions module (AD-2), written by hand to match db/migrations; the drift test compares them.
// The grants (select, insert and delete to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgPolicy, pgRole, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * One row per request a client was allowed in a window (S03.04, 20261002340000_search_log_rate_limit.sql): the scope and a
 * keyed hash of the client's address, never the address. Deleted after 24 hours (AD-13, AD-22).
 */
export const rateLimit = pgTable(
  "rate_limit",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    scope: text().notNull(),
    clientHash: text("client_hash").notNull(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rate_limit_client_idx").on(t.scope, t.clientHash, t.at),
    index("rate_limit_at_idx").on(t.at),
    check("rate_limit_scope_format", sql`${t.scope} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("rate_limit_client_hash_format", sql`${t.clientHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("rate_limit_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("rate_limit_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("rate_limit_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** places' neighbourhood, named here only so the foreign key below can be declared (subscriptions may not import places' schema, AD-2). Not exported. */
const neighbourhoodKey = pgTable("neighbourhood", { id: text().primaryKey() });

/** One place of a pending sign-up as the form sent it: a building by rsn, and floor ids in it (none: no floor recorded there). */
export interface PendingPlace {
  rsn: string;
  floors: string[];
}

/**
 * A pending sign-up (S07.02, 20261004220000_pending_signup.sql): a number that asked for text alerts and has not replied YES yet, with its
 * language, neighbourhood, optional places, groups and muted topics, the terms version it was shown and how it started; it expires 48 hours
 * after it was made. Personal data (AD-13): the number is read only by the ContactResolver's source and by the inbound router (S07.04).
 * The app inserts and deletes rows and never changes one. `delivery_forget_recipient('pending_signup')` (a trigger in the migration) is its
 * ON DELETE SET NULL.
 */
export const pendingSignup = pgTable(
  "pending_signup",
  {
    id: uuid().primaryKey(),
    phone: text().notNull(),
    lang: text().notNull(),
    neighbourhoodId: text("neighbourhood_id")
      .notNull()
      .references(() => neighbourhoodKey.id),
    places: jsonb().$type<PendingPlace[]>().notNull().default([]),
    groups: text().array().notNull().default(sql`'{}'`),
    topics: text().array().notNull().default(sql`'{}'`),
    consentVersion: text("consent_version").notNull(),
    startedBy: text("started_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '48 hours'`),
  },
  (t) => [
    uniqueIndex("pending_signup_phone_idx").on(t.phone),
    index("pending_signup_expires_at_idx").on(t.expiresAt),
    index("pending_signup_neighbourhood_id_idx").on(t.neighbourhoodId),
    check("pending_signup_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$'`),
    check("pending_signup_lang_known", sql`${t.lang} in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')`),
    check("pending_signup_places_array", sql`jsonb_typeof(${t.places}) = 'array' and jsonb_array_length(${t.places}) <= 60`),
    check("pending_signup_groups_known", sql`${t.groups} <@ array['seniors', 'newcomers', 'families', 'checkin']::text[] and cardinality(${t.groups}) <= 4`),
    check("pending_signup_topics_format", sql`cardinality(${t.topics}) <= 40 and array_to_string(${t.topics}, ',') ~ '^([a-z][a-z_]{1,19}(,[a-z][a-z_]{1,19})*)?$'`),
    check("pending_signup_consent_version_format", sql`${t.consentVersion} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*$'`),
    check("pending_signup_started_by_known", sql`${t.startedBy} in ('web', 'staff')`),
    check("pending_signup_expires_after_48_hours", sql`${t.expiresAt} = ${t.createdAt} + interval '48 hours'`),
    pgPolicy("pending_signup_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("pending_signup_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("pending_signup_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();
