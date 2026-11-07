// Drizzle tables of the partners module (AD-2: only tables this module owns), written by hand to match
// db/migrations/20261107110000_partner_space.sql; test/db/drift.db.test.ts compares them with the migrated database. The grants (the app reads
// everything, changes only a space's status columns and adds `space_change` rows) live only in the migration.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, check, date, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/** identity's staff_account, named only so the foreign keys below can be declared (partners may not import identity's schema, AD-2). Not exported. */
const staffKey = pgTable("staff_account", { id: uuid().primaryKey() });

const select = (name: string) => pgPolicy(`${name}_app_select`, { for: "select", to: cvhApp, using: sql`true` });

export const partnerOrg = pgTable(
  "partner_org",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    shortName: text("short_name").notNull(),
    kind: text().notNull(),
    sortOrder: smallint("sort_order").notNull(),
    contactRole: text("contact_role").notNull(),
    contactPhone: text("contact_phone").notNull(),
    contactEmail: text("contact_email").notNull(),
    capacity: text(),
    capacitySetAt: timestamp("capacity_set_at", { withTimezone: true }),
  },
  (t) => [
    check("partner_org_id_format", sql`${t.id} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
    check("partner_org_kind_known", sql`${t.kind} in ('hub', 'health', 'library', 'faith', 'tenants', 'settlement', 'city', 'relief')`),
    check("partner_org_capacity_known", sql`${t.capacity} is null or ${t.capacity} in ('available', 'stretched', 'at_capacity')`),
    check("partner_org_capacity_dated", sql`(${t.capacity} is null) = (${t.capacitySetAt} is null)`),
    check("partner_org_phone_fictional", sql`${t.contactPhone} ~ '^\\(\\d{3}\\) 555-01\\d{2}$'`),
    check("partner_org_email_fictional", sql`${t.contactEmail} ~ '@([a-z0-9-]+\\.)*example\\.org$'`),
    select("partner_org"),
  ],
).enableRLS();

export const space = pgTable(
  "space",
  {
    id: text().primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    providerId: text("provider_id"),
    name: text().notNull(),
    room: text(),
    street: text().notNull(),
    purpose: text().notNull(),
    status: text().notNull().default("not_activated"),
    capacityMax: integer("capacity_max").notNull(),
    capacityNow: integer("capacity_now"),
    opensAt: text("opens_at"),
    closesAt: text("closes_at"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by"),
    updatedBy: uuid("updated_by").references(() => staffKey.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("space_provider_id_idx").on(t.providerId).where(sql`${t.providerId} is not null`),
    index("space_org_id_idx").on(t.orgId),
    index("space_updated_by_idx").on(t.updatedBy),
    check("space_id_format", sql`${t.id} ~ '^SP[0-9]{2,4}$'`),
    check("space_provider_id_format", sql`${t.providerId} is null or ${t.providerId} ~ '^[A-Z][0-9]{3,6}$'`),
    check("space_purpose_known", sql`${t.purpose} in ('cooling', 'warming', 'clean_air', 'charging')`),
    check("space_status_known", sql`${t.status} in ('open', 'full', 'closed', 'not_activated')`),
    check("space_capacity_max_range", sql`${t.capacityMax} between 1 and 2000`),
    check("space_capacity_now_range", sql`${t.capacityNow} is null or ${t.capacityNow} between 0 and ${t.capacityMax}`),
    check("space_capacity_now_when_open", sql`${t.capacityNow} is null or ${t.status} in ('open', 'full')`),
    check("space_confirmed_when_open", sql`${t.status} not in ('open', 'full') or (${t.confirmedAt} is not null and ${t.confirmedBy} is not null)`),
    check(
      "space_hours_format",
      sql`(${t.opensAt} is null) = (${t.closesAt} is null) and (${t.opensAt} is null or (${t.opensAt} ~ '^[0-2][0-9]:[0-5][0-9]$' and ${t.closesAt} ~ '^[0-2][0-9]:[0-5][0-9]$'))`,
    ),
    select("space"),
    pgPolicy("space_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const spaceChange = pgTable(
  "space_change",
  {
    id: uuid().primaryKey().defaultRandom(),
    spaceId: text("space_id")
      .notNull()
      .references(() => space.id),
    status: text().notNull(),
    purpose: text().notNull(),
    capacityNow: integer("capacity_now"),
    capacityMax: integer("capacity_max").notNull(),
    changedBy: uuid("changed_by").references(() => staffKey.id),
    changedByLabel: text("changed_by_label").notNull(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("space_change_space_idx").on(t.spaceId, t.changedAt),
    index("space_change_changed_by_idx").on(t.changedBy),
    check("space_change_status_known", sql`${t.status} in ('open', 'full', 'closed', 'not_activated')`),
    check("space_change_purpose_known", sql`${t.purpose} in ('cooling', 'warming', 'clean_air', 'charging')`),
    select("space_change"),
    pgPolicy("space_change_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
  ],
).enableRLS();

export const sharedSpace = pgTable(
  "shared_space",
  {
    id: text().primaryKey(),
    hazard: text().notNull(),
    level: smallint().notNull(),
    location: text().notNull(),
    purpose: text().notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    openedBy: text("opened_by").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    check("shared_space_hazard_known", sql`${t.hazard} in ('power', 'elevator', 'heat', 'smoke', 'flood', 'fire', 'water', 'winter', 'other')`),
    check("shared_space_level_range", sql`${t.level} in (1, 2)`),
    check("shared_space_purpose_known", sql`${t.purpose} in ('coordinate', 'shelter', 'welfare', 'recovery')`),
    select("shared_space"),
  ],
).enableRLS();

export const partnerStatement = pgTable(
  "partner_statement",
  {
    id: text().primaryKey(),
    sharedSpaceId: text("shared_space_id")
      .notNull()
      .references(() => sharedSpace.id),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    person: text().notNull(),
    kind: text().notNull(),
    body: text().notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    claimedBy: text("claimed_by").references(() => partnerOrg.id),
    // A statement answers another of the same table: Drizzle needs the self-reference typed by hand.
    answers: text().references((): AnyPgColumn => partnerStatement.id),
  },
  (t) => [
    index("partner_statement_space_idx").on(t.sharedSpaceId, t.postedAt),
    index("partner_statement_org_idx").on(t.orgId),
    index("partner_statement_claimed_by_idx").on(t.claimedBy),
    index("partner_statement_answers_idx").on(t.answers),
    check("partner_statement_kind_known", sql`${t.kind} in ('doing', 'can_take', 'cannot_cover', 'need')`),
    select("partner_statement"),
  ],
).enableRLS();

export const partnerCommitment = pgTable(
  "partner_commitment",
  {
    id: text().primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    hazard: text().notNull(),
    mode: text().notNull(),
    body: text().notNull(),
    role: text().notNull(),
    agreement: text(),
    reviewDue: date("review_due", { mode: "string" }).notNull(),
    forDisruption: text("for_disruption"),
  },
  (t) => [
    index("partner_commitment_org_idx").on(t.orgId),
    check("partner_commitment_mode_known", sql`${t.mode} in ('everyday', 'during', 'recovery')`),
    check("partner_commitment_for_disruption_known", sql`${t.forDisruption} is null or ${t.forDisruption} in ('confirmed', 'declined')`),
    select("partner_commitment"),
  ],
).enableRLS();

export const partnerSupply = pgTable(
  "partner_supply",
  {
    id: text().primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    item: text().notNull(),
    qty: text().notNull(),
    qtyNum: integer("qty_num"),
    unit: text().notNull(),
    location: text().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("partner_supply_org_idx").on(t.orgId),
    check("partner_supply_item_known", sql`${t.item} in ('water', 'masks', 'power_banks', 'cots', 'blankets', 'interpreters', 'box_fans', 'flashlights', 'other')`),
    check("partner_supply_qty_known", sql`${t.qty} in ('few', 'some', 'plenty')`),
    select("partner_supply"),
  ],
).enableRLS();

export const partnerDecision = pgTable(
  "partner_decision",
  {
    id: text().primaryKey(),
    sharedSpaceId: text("shared_space_id")
      .notNull()
      .references(() => sharedSpace.id),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    person: text().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    body: text().notNull(),
    why: text().notNull(),
  },
  (t) => [index("partner_decision_space_idx").on(t.sharedSpaceId, t.decidedAt), index("partner_decision_org_idx").on(t.orgId), select("partner_decision")],
).enableRLS();

export const partnerHandover = pgTable(
  "partner_handover",
  {
    id: text().primaryKey(),
    sharedSpaceId: text("shared_space_id")
      .notNull()
      .references(() => sharedSpace.id),
    orgId: text("org_id")
      .notNull()
      .references(() => partnerOrg.id),
    fromPerson: text("from_person").notNull(),
    toPerson: text("to_person"),
    handedAt: timestamp("handed_at", { withTimezone: true }).notNull(),
    note: text().notNull(),
    openItems: jsonb("open_items").$type<string[]>().notNull().default([]),
  },
  (t) => [index("partner_handover_space_idx").on(t.sharedSpaceId, t.handedAt), index("partner_handover_org_idx").on(t.orgId), select("partner_handover")],
).enableRLS();

/** One version of a playbook, newest first in `history`. */
export interface PlaybookVersion {
  version: string;
  date: string;
  by: string;
  change: string;
}

export const playbook = pgTable(
  "playbook",
  {
    hazard: text().primaryKey(),
    state: text().notNull(),
    version: text(),
    agreedOn: date("agreed_on", { mode: "string" }),
    staleAfterMins: integer("stale_after_mins").notNull(),
    ambassadorPosting: text("ambassador_posting").notNull(),
    activated: jsonb().$type<string[]>().notNull().default([]),
    spaces: jsonb().$type<string[]>().notNull().default([]),
    templates: jsonb().$type<string[]>().notNull().default([]),
    asks: jsonb().$type<Record<string, string>>().notNull().default({}),
    steps: jsonb().$type<string[]>().notNull().default([]),
    history: jsonb().$type<PlaybookVersion[]>().notNull().default([]),
  },
  (t) => [
    check("playbook_hazard_known", sql`${t.hazard} in ('power', 'elevator', 'heat', 'smoke', 'flood', 'fire', 'water', 'winter', 'other')`),
    check("playbook_state_known", sql`${t.state} in ('agreed', 'proposed', 'placeholder')`),
    check("playbook_agreed_dated", sql`(${t.state} = 'agreed') = (${t.agreedOn} is not null)`),
    check("playbook_posting_known", sql`${t.ambassadorPosting} in ('direct', 'hub', 'none')`),
    select("playbook"),
  ],
).enableRLS();

export const partnerTeam = pgTable(
  "partner_team",
  {
    hazard: text().notNull(),
    level: smallint().notNull(),
    team: text(),
    channels: jsonb().$type<string[]>().notNull().default([]),
    triggerEvent: text("trigger_event"),
  },
  (t) => [primaryKey({ columns: [t.hazard, t.level] }), check("partner_team_level_range", sql`${t.level} in (1, 2)`), select("partner_team")],
).enableRLS();

export const partnerExercise = pgTable(
  "partner_exercise",
  {
    id: text().primaryKey(),
    hazard: text().notNull(),
    level: smallint().notNull(),
    title: text().notNull(),
    kind: text().notNull(),
    onDate: date("on_date", { mode: "string" }).notNull(),
    repeats: text().notNull().default("none"),
    tookPart: integer("took_part"),
  },
  (t) => [
    check("partner_exercise_kind_known", sql`${t.kind} in ('scheduled', 'past')`),
    check("partner_exercise_repeats_known", sql`${t.repeats} in ('none', 'q', 'h', 'y')`),
    check("partner_exercise_level_range", sql`${t.level} in (1, 2)`),
    select("partner_exercise"),
  ],
).enableRLS();

export const partnerIndicator = pgTable(
  "partner_indicator",
  {
    id: text().primaryKey(),
    sortOrder: smallint("sort_order").notNull(),
    realValue: text("real_value"),
    exerciseValue: text("exercise_value"),
    everydayValue: text("everyday_value"),
  },
  () => [select("partner_indicator")],
).enableRLS();

export const lookBackRecord = pgTable(
  "look_back_record",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    hazard: text().notNull(),
    place: text().notNull(),
    period: text().notNull(),
    title: text().notNull(),
    lessons: jsonb().$type<string[]>().notNull().default([]),
  },
  (t) => [
    check("look_back_record_kind_known", sql`${t.kind} in ('real', 'exercise')`),
    check("look_back_record_period_format", sql`${t.period} ~ '^[0-9]{4}-[0-9]{2}$'`),
    select("look_back_record"),
  ],
).enableRLS();

export const lookBackAction = pgTable(
  "look_back_action",
  {
    id: text().primaryKey(),
    lesson: text().notNull(),
    body: text().notNull(),
    ownerRole: text("owner_role").notNull(),
    due: date({ mode: "string" }).notNull(),
    status: text().notNull(),
    changed: text(),
  },
  (t) => [check("look_back_action_status_known", sql`${t.status} in ('open', 'done')`), select("look_back_action")],
).enableRLS();
