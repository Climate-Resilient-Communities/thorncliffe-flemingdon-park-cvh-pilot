// Drizzle tables of the identity module (AD-2), written by hand to match
// db/migrations/20261002110000_staff_account.sql, 20261002130000_sign_in.sql,
// 20261002131000_staff_session.sql and 20261002150000_session_revocation.sql; the drift test
// compares them.
// The bootstrap row's forward-only trigger and the grants live only in the migration.
import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgEnum, pgPolicy, pgRole, pgTable, primaryKey, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
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
    startingPasswordUsedAt: timestamp("starting_password_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by").references((): AnyPgColumn => staffAccount.id),
    /** S01.08: how many times the account's sessions were revoked (sign-in compares it). */
    sessionGeneration: integer("session_generation").notNull().default(0),
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
    check("staff_account_starting_password_used", sql`${t.startingPasswordUsedAt} is null or ${t.mustChangePassword}`),
    check("staff_account_session_generation_non_negative", sql`${t.sessionGeneration} >= 0`),
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

/** One checked, failed sign-in (S01.07). Username and client only as keyed hashes; kept at most 24 hours. */
export const signInFailure = pgTable(
  "sign_in_failure",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: timestamp({ withTimezone: true }).notNull(),
    usernameHash: text("username_hash").notNull(),
    clientHash: text("client_hash").notNull(),
  },
  (t) => [
    index("sign_in_failure_username_idx").on(t.usernameHash, t.at),
    index("sign_in_failure_client_idx").on(t.clientHash, t.at),
    index("sign_in_failure_at_idx").on(t.at),
    check("sign_in_failure_username_hash_format", sql`${t.usernameHash} ~ '^[0-9a-f]{64}$'`),
    check("sign_in_failure_client_hash_format", sql`${t.clientHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("sign_in_failure_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sign_in_failure_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("sign_in_failure_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** A username lock or a client block started by failed sign-ins (S01.07). */
export const signInLock = pgTable(
  "sign_in_lock",
  {
    kind: text().notNull(),
    keyHash: text("key_hash").notNull(),
    lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.keyHash] }),
    index("sign_in_lock_locked_until_idx").on(t.lockedUntil),
    check("sign_in_lock_kind", sql`${t.kind} in ('username', 'client')`),
    check("sign_in_lock_key_hash_format", sql`${t.keyHash} ~ '^[0-9a-f]{64}$'`),
    pgPolicy("sign_in_lock_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("sign_in_lock_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("sign_in_lock_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
    pgPolicy("sign_in_lock_app_delete", { for: "delete", to: cvhApp, using: sql`true` }),
  ],
).enableRLS();

/** A staff session the app opened (S01.07); S01.08 adds its idle and absolute limits. */
export const staffSession = pgTable(
  "staff_session",
  {
    id: text().primaryKey(),
    staffAccountId: uuid("staff_account_id")
      .notNull()
      .references(() => staffAccount.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("staff_session_account_idx").on(t.staffAccountId).where(sql`${t.revokedAt} is null`),
    index("staff_session_created_at_idx").on(t.createdAt),
    check("staff_session_id_format", sql`${t.id} ~ '^[0-9a-f]{64}$'`),
    check("staff_session_seen_after_created", sql`${t.lastSeenAt} >= ${t.createdAt}`),
    pgPolicy("staff_session_app_select", { for: "select", to: cvhApp, using: sql`true` }),
    pgPolicy("staff_session_app_insert", { for: "insert", to: cvhApp, withCheck: sql`true` }),
    pgPolicy("staff_session_app_update", { for: "update", to: cvhApp, using: sql`true`, withCheck: sql`true` }),
  ],
).enableRLS();

export type StaffAccountRow = typeof staffAccount.$inferSelect;
export type StaffBootstrapRow = typeof staffBootstrap.$inferSelect;
