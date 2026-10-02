// Drizzle tables of the places module (AD-2: only tables this module owns). Written by hand to
// match db/migrations/20261002210000_buildings_floors.sql and 20261002260000_building_contact.sql; test/db/drift.db.test.ts compares them
// with the migrated database. Grants (select, the confirmation columns and the floors to cvh_app,
// none to anyone else) live only in the migration.
import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, foreignKey, index, integer, pgPolicy, pgRole, pgTable, smallint, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/** The app's own database role (created by S01.04's migration). */
const cvhApp = pgRole("cvh_app").existing();

/**
 * identity's staff_account, named here only so the foreign key below can be declared: Drizzle needs
 * a table object, and places may not import identity (AD-2). Not exported, so nothing reads or
 * writes it through this module; the real definition is src/modules/identity/adapters/schema.ts.
 */
const staffAccountKey = pgTable("staff_account", { id: uuid().primaryKey() });

export const neighbourhood = pgTable(
  "neighbourhood",
  {
    id: text().primaryKey(),
    name: text().notNull(),
    fsa: text().notNull().unique(),
  },
  (t) => [
    check("neighbourhood_id_format", sql`${t.id} ~ '^[A-Z]{2,6}$'`),
    check("neighbourhood_name_present", sql`btrim(${t.name}) <> ''`),
    check("neighbourhood_fsa_format", sql`${t.fsa} ~ '^[A-Z][0-9][A-Z]$'`),
    pgPolicy("neighbourhood_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

export const building = pgTable(
  "building",
  {
    rsn: text().primaryKey(),
    neighbourhoodId: text("neighbourhood_id")
      .notNull()
      .references(() => neighbourhood.id),
    address: text().notNull(),
    latitude: doublePrecision().notNull(),
    longitude: doublePrecision().notNull(),
    storeys: smallint(),
    elevators: smallint(),
    emergencyPower: boolean("emergency_power"),
    coolingRoom: boolean("cooling_room"),
    airConditioning: text("air_conditioning"),
    barrierFreeEntrance: boolean("barrier_free_entrance"),
    factsUpdatedAt: timestamp("facts_updated_at", { withTimezone: true }).notNull(),
    notInRegisterSince: timestamp("not_in_register_since", { withTimezone: true }),
    floorsConfirmedAt: timestamp("floors_confirmed_at", { withTimezone: true }),
    floorsConfirmedBy: uuid("floors_confirmed_by"),
    /** The building contact an Admin enters (S02.08): a role code and an E.164 phone number, all four set or all null. */
    contactRole: text("contact_role"),
    contactPhone: text("contact_phone"),
    contactOwner: text("contact_owner"),
    contactUpdatedAt: timestamp("contact_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("building_rsn_format", sql`${t.rsn} ~ '^[0-9]{1,9}$'`),
    check("building_address_present", sql`btrim(${t.address}) <> ''`),
    check("building_coordinates_valid", sql`${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180`),
    check("building_storeys_valid", sql`${t.storeys} is null or ${t.storeys} between 1 and 150`),
    check("building_elevators_valid", sql`${t.elevators} is null or ${t.elevators} >= 0`),
    check("building_confirmation_complete", sql`(${t.floorsConfirmedAt} is null) = (${t.floorsConfirmedBy} is null)`),
    check("building_contact_role_valid", sql`${t.contactRole} is null or ${t.contactRole} in ('superintendent', 'building_management', 'property_office')`),
    check("building_contact_phone_valid", sql`${t.contactPhone} is null or ${t.contactPhone} ~ '^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$'`),
    check("building_contact_owner_valid", sql`${t.contactOwner} is null or ${t.contactOwner} = 'hub'`),
    check(
      "building_contact_complete",
      sql`(${t.contactRole} is null and ${t.contactPhone} is null and ${t.contactOwner} is null and ${t.contactUpdatedAt} is null) or (${t.contactRole} is not null and ${t.contactPhone} is not null and ${t.contactOwner} is not null and ${t.contactUpdatedAt} is not null)`,
    ),
    foreignKey({ name: "building_floors_confirmed_by_fkey", columns: [t.floorsConfirmedBy], foreignColumns: [staffAccountKey.id] }),
    index("building_neighbourhood_id_idx").on(t.neighbourhoodId),
    index("building_floors_confirmed_by_idx").on(t.floorsConfirmedBy),
    pgPolicy("building_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("building_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const buildingFloor = pgTable(
  "building_floor",
  {
    id: uuid().primaryKey(),
    rsn: text()
      .notNull()
      .references(() => building.rsn),
    label: text().notNull(),
    /** The label without spaces, lower case: what "the same label" means within a building. */
    labelKey: text("label_key").generatedAlwaysAs(sql`lower(replace(label, ' ', ''))`),
    sortOrder: integer("sort_order").notNull(),
    confirmed: boolean().notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("building_floor_label_format", sql`${t.label} ~ '^[A-Za-z0-9 -]{1,8}$' and ${t.label} ~ '[A-Za-z0-9]' and ${t.label} = btrim(${t.label}) and ${t.label} !~ '  '`),
    unique("building_floor_label_unique").on(t.rsn, t.labelKey),
    pgPolicy("building_floor_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("building_floor_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("building_floor_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
    pgPolicy("building_floor_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/**
 * S04.03: the types of disruption, seeded by the migration (20261002250000_alert_lifecycle.sql).
 * `direct` is whether an Ambassador's post of that type may appear on the web at once (D-1, AD-5):
 * true for the lower-risk types, false for fire and "Other", null (not decided, counts as false)
 * for the neighbourhood-wide ones. The app only reads it.
 */
export const disruptionType = pgTable(
  "disruption_type",
  {
    id: text().primaryKey(),
    direct: boolean(),
  },
  (t) => [
    check("disruption_type_id_format", sql`${t.id} ~ '^[a-z][a-z_]{1,19}$'`),
    pgPolicy("disruption_type_app_select", { for: "select", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();
