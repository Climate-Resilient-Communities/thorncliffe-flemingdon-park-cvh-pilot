// Drizzle tables of the ops module (AD-2), written by hand to match db/migrations/20261002230000_directory_release.sql;
// the drift test compares them. The grants (select and insert to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, jsonb, pgPolicy, pgRole, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be declared: Drizzle needs a table object, and ops may not
 * import identity's schema (AD-2). Not exported; the real definition is src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

export const opsEvent = pgTable(
  "ops_event",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    kind: text().notNull(),
    severity: text().notNull(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    detail: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index("ops_event_kind_at_idx").on(t.kind, t.at),
    check("ops_event_kind_format", sql`${t.kind} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*){0,3}$' and char_length(${t.kind}) <= 64`),
    check("ops_event_severity", sql`${t.severity} in ('info', 'warning', 'error')`),
    check("ops_event_subject_type_format", sql`${t.subjectType} is null or ${t.subjectType} ~ '^[a-z][a-z0-9_]{0,39}$'`),
    check("ops_event_subject_id_format", sql`${t.subjectId} is null or ${t.subjectId} ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check("ops_event_detail_object", sql`jsonb_typeof(${t.detail}) = 'object'`),
    pgPolicy("ops_event_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("ops_event_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The on-call roster (S06.07): the Admins' numbers that are texted when sending is stuck or failing. Personal data (AD-13): the number is read
 * only by the ContactResolver's source and by the roster screen (masked), and goes into no log, audit record, `ops_event` or `delivery`. The app
 * adds and deletes rows and changes only an entry's role and account (S08.08's on-duty Admin; the migration's guard keeps the rest as written).
 * `delivery_forget_recipient('oncall')` (a trigger in the migration) is its ON DELETE SET NULL.
 */
export const oncallRoster = pgTable(
  "oncall_roster",
  {
    id: uuid().primaryKey(),
    label: text().notNull(),
    phone: text().notNull(),
    addedBy: uuid("added_by")
      .notNull()
      .references(() => staffAccountKey.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** S08.08: `oncall`, or `on_duty` (at most one entry): the Admin who gets the check-in escalations, named by `staffId`. */
    role: text().notNull().default("oncall"),
    /** S08.08: the Admin account an on-duty entry belongs to (an active Admin with an authenticator, checked at the change); null for an `oncall` entry. */
    staffId: uuid("staff_id").references(() => staffAccountKey.id),
  },
  (t) => [
    uniqueIndex("oncall_roster_phone_idx").on(t.phone),
    index("oncall_roster_added_by_idx").on(t.addedBy),
    uniqueIndex("oncall_roster_one_on_duty_idx").on(t.role).where(sql`${t.role} = 'on_duty'`),
    index("oncall_roster_staff_id_idx").on(t.staffId),
    check("oncall_roster_label_format", sql`btrim(${t.label}) <> '' and char_length(${t.label}) <= 40 and ${t.label} !~ '[[:cntrl:]]'`),
    check("oncall_roster_phone_format", sql`${t.phone} ~ '^\\+1[2-9][0-9]{9}$'`),
    check("oncall_roster_role_known", sql`${t.role} in ('oncall', 'on_duty')`),
    check("oncall_roster_on_duty_linked", sql`(${t.role} = 'on_duty') = (${t.staffId} is not null)`),
    pgPolicy("oncall_roster_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("oncall_roster_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("oncall_roster_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
    pgPolicy("oncall_roster_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * What the health job (`/api/jobs/health`) remembers of each condition it watches (S06.07): whether it holds, since when, when the on-call
 * Admins were last texted about it and up to which `ops_event` it has told them. No personal data. The rows are made by the migrations (five by
 * S06.07, five more by S09.01).
 */
export const healthCondition = pgTable(
  "health_condition",
  {
    condition: text().primaryKey(),
    active: boolean().notNull().default(false),
    since: timestamp({ withTimezone: true }),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    lastEventId: bigint("last_event_id", { mode: "number" }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "health_condition_known",
      sql`${t.condition} in ('queue_stuck', 'delivery_unknown', 'sender_stalled', 'smart_encoding_on', 'signature_failures', 'job_failed', 'translation_fallback', 'publish_failed', 'transactional_ceiling', 'cap_overrun', 'messaging_settings', 'provider_auth')`,
    ),
    check("health_condition_since_stated", sql`${t.active} = (${t.since} is not null)`),
    pgPolicy("health_condition_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("health_condition_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

/**
 * The health job's heartbeat (S09.01): one row, the time of its last run that judged every condition. `/api/health/heartbeat` answers 200 only
 * while it is less than 3 minutes old; an uptime monitor outside the CVH's providers calls it every minute. Made by the migration.
 */
export const healthHeartbeat = pgTable(
  "health_heartbeat",
  {
    id: smallint().primaryKey().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("health_heartbeat_one_row", sql`${t.id} = 1`),
    pgPolicy("health_heartbeat_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("health_heartbeat_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();
