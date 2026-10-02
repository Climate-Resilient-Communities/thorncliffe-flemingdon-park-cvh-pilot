import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { BootstrapState } from "../domain/bootstrap";
import type { StaffAccount } from "../domain/staffAccount";

export type CreateLoginError =
  /** An auth user with this login already exists. */
  | "login_taken"
  /** The provider refused the request itself, for example the project's password policy; retrying cannot help. */
  | "rejected"
  /** The provider could not be reached or failed. */
  | "unavailable";

export interface FoundLogin {
  authUserId: string;
  createdAt: Date;
  /** True when the provider user carries the marker createLogin sets (app_metadata.cvh_staff). */
  staffMarker: boolean;
}

/**
 * Port: the identity provider that holds sign-in credentials (Supabase Auth, AD-4). The app keeps
 * people's details on staff_account; the provider holds only the login, the password and, from
 * S01.10, the authenticator. Later stories add what they need here (S01.07 sign-in and password
 * change, S01.08 session revocation, S01.10 factor enrolment, S01.11 factor reset).
 */
export interface IdentityProvider {
  /** Creates a confirmed auth user with this login and password. Sends nothing to anyone. */
  createLogin(input: { login: string; password: string }): Promise<{ ok: true; authUserId: string } | { ok: false; error: CreateLoginError }>;
  /**
   * The auth user with this login, if any: its id, when it was created and whether it carries the
   * app's staff marker (set by createLogin), so a login left behind by this app can be told from
   * one made by anyone else. Throws on failure.
   */
  findLogin(login: string): Promise<FoundLogin | null>;
  /** Deletes an auth user; used to undo a createLogin whose account was then refused. Throws on failure. */
  deleteLogin(authUserId: string): Promise<void>;
  /** True when the auth user has a verified TOTP factor (S01.10 enrols them). Throws on failure. */
  hasVerifiedAuthenticator(authUserId: string): Promise<boolean>;
}

/** A new staff_account row. */
export interface NewStaffRow {
  id: string;
  authUserId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: StaffAccount["role"];
  startingPasswordIssuedAt: Date;
  createdBy: string | null;
}

/** Port: the identity module's tables (staff_account, staff_bootstrap). */
export interface StaffStore {
  findById(db: DbExecutor, id: string): Promise<StaffAccount | null>;
  usernameTaken(db: DbExecutor, username: string): Promise<boolean>;
  /** True when a staff_account is linked to this auth user. */
  authUserLinked(db: DbExecutor, authUserId: string): Promise<boolean>;
  adminExists(db: DbExecutor): Promise<boolean>;
  readBootstrap(db: DbExecutor): Promise<BootstrapState | null>;
  /**
   * Serialises account creation and bootstrap changes: held until the transaction ends, so two
   * concurrent requests re-check what they read before writing one after the other.
   */
  lockAccounts(tx: DbTransaction): Promise<void>;
  insertAccount(tx: DbTransaction, row: NewStaffRow): Promise<void>;
  startBootstrap(tx: DbTransaction, firstAdminId: string): Promise<void>;
  setSecondAdmin(tx: DbTransaction, secondAdminId: string): Promise<void>;
  completeBootstrap(tx: DbTransaction): Promise<void>;
}

/** Port: the operational error log (structured, no personal data). */
export interface OperationalLog {
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
}
