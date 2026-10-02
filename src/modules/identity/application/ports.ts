import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { BootstrapState } from "../domain/bootstrap";
import type { StaffAccount } from "../domain/staffAccount";

export type CreateLoginError =
  /** An auth user with this login already exists. */
  | "login_taken"
  /** The provider refused the request (for example its password rules). */
  | "rejected"
  /** The provider could not be reached or failed. */
  | "unavailable";

/**
 * Port: the identity provider that holds sign-in credentials (Supabase Auth, AD-4). The app keeps
 * people's details on staff_account; the provider holds only the login, the password and, from
 * S01.10, the authenticator. Later stories add what they need here (S01.07 sign-in and password
 * change, S01.08 session revocation, S01.10 factor enrolment, S01.11 factor reset).
 */
export interface IdentityProvider {
  /** Creates a confirmed auth user with this login and password. Sends nothing to anyone. */
  createLogin(input: { login: string; password: string }): Promise<{ ok: true; authUserId: string } | { ok: false; error: CreateLoginError }>;
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
  /** Every Admin account, whatever its status (the shortfall banner's count). */
  listAdmins(db: DbExecutor): Promise<StaffAccount[]>;
  /**
   * The two-Admin rule's lock (S01.06): locks every Admin row and the given account's row
   * (`for update`, in id order) until the transaction ends, and returns them as they are once
   * locked. Concurrent changes to Admins then run one after the other, each counting what the
   * other committed.
   */
  lockAdminsAndAccount(tx: DbTransaction, staffId: string): Promise<StaffAccount[]>;
  /**
   * Lets this transaction leave fewer than two usable Admins: the recovery exception and the
   * automatic locks only. The database trigger staff_account_keep_two_usable_admins refuses such an
   * UPDATE otherwise. The setting ends with the transaction.
   */
  permitAdminShortfall(tx: DbTransaction): Promise<void>;
  setStatus(tx: DbTransaction, staffId: string, status: StaffAccount["status"]): Promise<void>;
  setRole(tx: DbTransaction, staffId: string, role: StaffAccount["role"]): Promise<void>;
}

/** Port: the operational error log (structured, no personal data). */
export interface OperationalLog {
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
}
