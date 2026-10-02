// Drizzle tables of the ops module (AD-2), written by hand to match db/migrations/20261002230000_directory_release.sql;
// the drift test compares them. The grants (select and insert to cvh_app, nothing to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgPolicy, pgRole, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

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
