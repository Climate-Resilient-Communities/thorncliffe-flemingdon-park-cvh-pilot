// Drizzle tables of the identity module (AD-2), written by hand to match
// db/migrations/20261002110000_staff_account.sql; the drift test compares them.
// The bootstrap row's forward-only trigger and the grants live only in the migration.
import { sql } from "drizzle-orm";
import { boolean, check, pgEnum, pgPolicy, pgRole, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { STAFF_STATUSES } from "../domain/staffAccount";

/** The app's own database role (created by the audit migration). */
const cvhApp = pgRole("cvh_app").existing();

export const staffRole = pgEnum("staff_role", STAFF_ROLES);
export const staffStatus = pgEnum("staff_status", STAFF_STATUSES);

export const staffAccount = pgTable(
  "staff_account",
  {
    id: uuid().primaryKey(),
    authUserId: uuid("auth_user_id").notNull().unique(),
    username: text().notNull().unique(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text().notNull(),
    role: staffRole().notNull(),
    status: staffStatus().notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    startingPasswordIssuedAt: timestamp("starting_password_issued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references((): AnyPgColumn => staffAccount.id),
  },
  (t) => [
    check(
      "staff_account_username_format",
      sql`char_length(${t.username}) between 3 and 32 and ${t.username} ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
    ),
    check("staff_account_first_name_length", sql`char_length(btrim(${t.firstName})) between 1 and 100`),
    check("staff_account_last_name_length", sql`char_length(btrim(${t.lastName})) between 1 and 100`),
    check(
      "staff_account_email_format",
      sql`char_length(${t.email}) <= 254 and ${t.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$'`,
    ),
    check(
      "staff_account_starting_password_issued",
      sql`not ${t.mustChangePassword} or ${t.startingPasswordIssuedAt} is not null`,
    ),
    pgPolicy("staff_account_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("staff_account_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("staff_account_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export const staffBootstrap = pgTable(
  "staff_bootstrap",
  {
    singleton: boolean().primaryKey().default(true),
    firstAdminId: uuid("first_admin_id").notNull().unique().references(() => staffAccount.id),
    secondAdminId: uuid("second_admin_id").unique().references(() => staffAccount.id),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    check("staff_bootstrap_one_row", sql`${t.singleton}`),
    check("staff_bootstrap_two_admins", sql`${t.secondAdminId} is null or ${t.secondAdminId} <> ${t.firstAdminId}`),
    check("staff_bootstrap_completed_with_second_admin", sql`${t.completedAt} is null or ${t.secondAdminId} is not null`),
    pgPolicy("staff_bootstrap_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("staff_bootstrap_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("staff_bootstrap_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export type StaffAccountRow = typeof staffAccount.$inferSelect;
export type StaffBootstrapRow = typeof staffBootstrap.$inferSelect;
