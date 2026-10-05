// Drizzle tables of the subscriptions module (AD-2), written by hand to match db/migrations; the drift test compares them.
// The grants (select, insert and delete to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, date, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be declared: Drizzle needs a table object, and subscriptions may not
 * import identity's schema (AD-2). Not exported; the real definition is src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

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

/**
 * The drill roster (S06.05, db/migrations/20261004110000_drill_roster.sql): the staff phones a drill is texted on. Personal data (AD-13), protected as
 * the on-call roster is: the number is read only by the ContactResolver's source and by the roster screen (masked), and goes into no log, audit
 * record or `delivery`. The app adds, changes (label, number, language) and deletes rows. `delivery_forget_recipient('roster')` (a trigger in the
 * migration) is its ON DELETE SET NULL, and the delivery insert guard refuses a drill text to anyone who is not a row of this table.
 */
export const drillRoster = pgTable(
  "drill_roster",
  {
    id: uuid().primaryKey(),
    label: text().notNull(),
    phone: text().notNull(),
    lang: text().notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => staffAccountKey.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("drill_roster_phone_idx").on(t.phone),
    index("drill_roster_added_by_idx").on(t.addedBy),
    check("drill_roster_label_format", sql`btrim(${t.label}) <> '' and char_length(${t.label}) <= 40 and ${t.label} !~ '[[:cntrl:]]'`),
    check("drill_roster_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{9}$'`),
    check(
      "drill_roster_lang_valid",
      sql`${t.lang} in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'zh-Hant')`,
    ),
    pgPolicy("drill_roster_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("drill_roster_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("drill_roster_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
    pgPolicy("drill_roster_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** places' building, building_floor and disruption_type, named here only for the foreign keys below (AD-2). Not exported. */
const buildingKey = pgTable("building", { rsn: text().primaryKey() });
const buildingFloorKey = pgTable("building_floor", { id: uuid().primaryKey() });
const disruptionTypeKey = pgTable("disruption_type", { id: text().primaryKey() });

/**
 * A subscriber (S07.04, 20261006010000_subscriber_inbound.sql): a number that replied YES, made from its pending sign-up. Personal data
 * (AD-13): the number is read only by the ContactResolver's source, the inbound router and the web sign-up's "already subscribed" lookup.
 * The app inserts and deletes rows (STOP and a confirmed reply 0 delete everything); `delivery_forget_recipient('subscriber')` is its
 * ON DELETE SET NULL.
 */
export const subscriber = pgTable(
  "subscriber",
  {
    id: uuid().primaryKey(),
    phone: text().notNull(),
    lang: text().notNull(),
    neighbourhoodId: text("neighbourhood_id")
      .notNull()
      .references(() => neighbourhoodKey.id),
    groups: text().array().notNull().default(sql`'{}'`),
    consentVersion: text("consent_version").notNull(),
    startedBy: text("started_by").notNull(),
    retentionState: text("retention_state").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriber_phone_idx").on(t.phone),
    index("subscriber_neighbourhood_id_idx").on(t.neighbourhoodId),
    check("subscriber_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$'`),
    check("subscriber_lang_known", sql`${t.lang} in ('en', 'ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr')`),
    check("subscriber_groups_known", sql`${t.groups} <@ array['seniors', 'newcomers', 'families', 'checkin']::text[] and cardinality(${t.groups}) <= 4`),
    check("subscriber_consent_version_format", sql`${t.consentVersion} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\\.[1-9][0-9]*$'`),
    check("subscriber_started_by_known", sql`${t.startedBy} in ('web', 'staff')`),
    check("subscriber_retention_state_known", sql`${t.retentionState} in ('active', 'reconsent_pending', 'retained')`),
    pgPolicy("subscriber_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("subscriber_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("subscriber_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
    pgPolicy("subscriber_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** One building of a subscriber, with one floor in it or none (null: no floor recorded there). See AudienceProfile in src/contracts/audience.ts. */
export const subscriberPlace = pgTable(
  "subscriber_place",
  {
    id: uuid().primaryKey(),
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscriber.id, { onDelete: "cascade" }),
    rsn: text()
      .notNull()
      .references(() => buildingKey.rsn),
    floorId: uuid("floor_id").references(() => buildingFloorKey.id, { onDelete: "set null" }),
  },
  (t) => [
    index("subscriber_place_subscriber_id_idx").on(t.subscriberId),
    index("subscriber_place_rsn_idx").on(t.rsn),
    index("subscriber_place_floor_id_idx").on(t.floorId),
    pgPolicy("subscriber_place_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("subscriber_place_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("subscriber_place_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** A topic (disruption type) a subscriber muted. */
export const subscriberTopicOptout = pgTable(
  "subscriber_topic_optout",
  {
    subscriberId: uuid("subscriber_id")
      .notNull()
      .references(() => subscriber.id, { onDelete: "cascade" }),
    topic: text()
      .notNull()
      .references(() => disruptionTypeKey.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.subscriberId, t.topic] }),
    index("subscriber_topic_optout_topic_idx").on(t.topic),
    pgPolicy("subscriber_topic_optout_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("subscriber_topic_optout_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("subscriber_topic_optout_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** A subscriber's one open prompt (S07.04: `delete_confirm`, the "reply 0 again" step; S07.05 adds the menus' steps). */
export const smsPrompt = pgTable(
  "sms_prompt",
  {
    subscriberId: uuid("subscriber_id")
      .primaryKey()
      .references(() => subscriber.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    step: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("sms_prompt_expires_at_idx").on(t.expiresAt),
    check("sms_prompt_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("sms_prompt_step_object", sql`jsonb_typeof(${t.step}) = 'object'`),
    check("sms_prompt_expires_after_sent", sql`${t.expiresAt} > ${t.sentAt} and ${t.expiresAt} <= ${t.sentAt} + interval '1 hour'`),
    pgPolicy("sms_prompt_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sms_prompt_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("sms_prompt_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** The sha256 of each inbound MessageSid, kept 48 hours, so a retried webhook changes nothing. */
export const inboundSeen = pgTable(
  "inbound_seen",
  {
    sidHash: text("sid_hash").primaryKey(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inbound_seen_received_at_idx").on(t.receivedAt),
    check("inbound_seen_sid_hash_format", sql`${t.sidHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("inbound_seen_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("inbound_seen_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();

/** A number with no subscription awaiting its one reply, at most 30 minutes; deleted in the hand-off transaction. */
export const inboundReply = pgTable(
  "inbound_reply",
  {
    id: uuid().primaryKey(),
    phone: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '30 minutes'`),
  },
  (t) => [
    index("inbound_reply_phone_idx").on(t.phone),
    index("inbound_reply_expires_at_idx").on(t.expiresAt),
    check("inbound_reply_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$'`),
    check("inbound_reply_expires_after_30_minutes", sql`${t.expiresAt} = ${t.createdAt} + interval '30 minutes'`),
    pgPolicy("inbound_reply_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("inbound_reply_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("inbound_reply_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** How many inbound messages carried each keyword on each day (Toronto): the only trace of an inbound body. */
export const inboundKeywordCount = pgTable(
  "inbound_keyword_count",
  {
    day: date().notNull(),
    keyword: text().notNull(),
    count: integer().notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.day, t.keyword] }),
    check("inbound_keyword_count_keyword_known", sql`${t.keyword} in ('stop', 'start', 'help', 'yes', '0', '1', '2', '3', 'other')`),
    check("inbound_keyword_count_positive", sql`${t.count} > 0`),
    pgPolicy("inbound_keyword_count_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("inbound_keyword_count_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("inbound_keyword_count_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
