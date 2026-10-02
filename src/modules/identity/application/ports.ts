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
  /**
   * Replaces the auth user's password (S01.07: the person's own password, or an Admin's re-issue of
   * the starting password). The old password stops working at once, and every session the user has
   * at the provider ends: this is the provider's global sign-out (Supabase's admin password update
   * signs the user out everywhere; it has no other admin call that does). `password` is what the
   * provider stores, the peppered form (passwordPepper.ts), never the person's own text.
   */
  setPassword(authUserId: string, password: string): Promise<{ ok: true } | { ok: false; error: SetPasswordError }>;
}

export type SetPasswordError =
  /** The provider refused the password (for example its own password rules). */
  | "rejected"
  /** The provider could not be reached or failed. */
  | "unavailable";

/** Options of a cookie the session adapter writes; the subset both Next.js and @supabase/ssr use. */
export interface SessionCookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none" | boolean;
}

/** The request's cookies, as the composition root hands them to a session adapter (no framework types here). */
export interface CookieJar {
  getAll(): { name: string; value: string }[];
  /** Writes cookies on the response. Where a response cannot set cookies (a page render) it is a no-op. */
  setAll(cookies: { name: string; value: string; options: SessionCookieOptions }[]): void;
}

/**
 * A checked password: the provider accepted it and opened a session, which is held back until the
 * app decides. `accept` writes the session's cookies; `discard` ends the session at the provider
 * and writes nothing, so a refused sign-in (lock, expiry) never leaves a usable session behind.
 * `sessionKey` names the new session as staff_session does (see SessionIdentity), and
 * `tokenLifetimeSeconds` is its access token's `exp - iat` (null when the token does not say).
 */
export type PasswordCheck =
  | { ok: true; authUserId: string; sessionKey: string; tokenLifetimeSeconds: number | null; accept(): Promise<void>; discard(): Promise<void> }
  | { ok: false; error: "invalid_credentials" | "unavailable" };

/**
 * The verified user of a request's session. `sessionKey` is the staff_session id of the session:
 * SHA-256 (hex) of the access token's `session_id` claim, read only after the provider verified the
 * token. Supabase Auth puts `session_id` in every access token it issues and keeps it across
 * refreshes, so it names the session itself; it issues no `jti`. A token without `session_id` is
 * keyed by the SHA-256 of `access-token:` and the whole token instead: unique to that token, and
 * still the whole session here because sessions are never refreshed (supabaseAuthSessions.ts).
 */
export interface SessionUser {
  authUserId: string;
  authenticatorEnrolled: boolean;
  sessionKey: string;
}

/**
 * Port: the signed-in session of one request, kept in its cookies (Supabase Auth through
 * @supabase/ssr in the app; the in-memory fake in tests). Built per request from a CookieJar.
 */
export interface AuthSessions {
  /** Checks a login and password and opens a held-back session (see PasswordCheck). */
  checkPassword(input: { login: string; password: string }): Promise<PasswordCheck>;
  /**
   * The verified user of the request's session (checked with the provider, never only decoded
   * from the cookie), or null when there is none or it is not valid. Throws when the provider
   * cannot be reached, so a failure is never mistaken for a session.
   */
  currentUser(): Promise<SessionUser | null>;
  /** Ends this session at the provider and clears its cookies. Never throws. */
  signOut(): Promise<void>;
}

export type AuthSessionsFactory = (cookies: CookieJar) => AuthSessions;

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
  findByUsername(db: DbExecutor, username: string): Promise<StaffAccount | null>;
  findByAuthUserId(db: DbExecutor, authUserId: string): Promise<StaffAccount | null>;
  /** Records the starting password's one successful sign-in. */
  markStartingPasswordUsed(tx: DbTransaction, id: string, at: Date): Promise<void>;
  /** `active` → `locked_pending_reissue`, only while a starting password is in use. True when it changed. */
  lockPendingReissue(tx: DbTransaction, id: string): Promise<boolean>;
  /**
   * The person replaced the starting password: clears `must_change_password` and the starting
   * password's dates, only while the account is still active on the starting password issued at
   * `issuedAt` (a re-issue or reset since then changes it). True when it changed.
   */
  completePasswordChange(tx: DbTransaction, id: string, issuedAt: Date | null): Promise<boolean>;
  /** An Admin re-issued the starting password: active again, a new 24-hour window, unused. */
  reissueStartingPassword(tx: DbTransaction, id: string, issuedAt: Date): Promise<boolean>;
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
  /** Every Admin account, whatever its status (the shortfall banner's count). */
  listAdmins(db: DbExecutor): Promise<StaffAccount[]>;
  /**
   * The two-Admin rule's lock (S01.06): locks every Admin row and the given account's row
   * (`for update`, in id order) until the transaction ends, and returns them as they are once
   * locked. Concurrent changes to Admins then run one after the other, each counting what the
   * other committed.
   */
  lockAdminsAndAccount(tx: DbTransaction, staffId: string): Promise<StaffAccount[]>;
  /** Locks one account's row (`for update`) until the transaction ends, and returns it as locked (null if there is none). */
  lockAccount(tx: DbTransaction, staffId: string): Promise<StaffAccount | null>;
  /** Makes this transaction fail, rather than wait, when a row lock held by another is not free within `ms` (set local lock_timeout). */
  setLockTimeout(tx: DbTransaction, ms: number): Promise<void>;
  /**
   * Lets this transaction leave fewer than two usable Admins: the recovery exception and the
   * automatic locks only. The database trigger staff_account_keep_two_usable_admins refuses such an
   * UPDATE otherwise. The setting ends with the transaction.
   */
  permitAdminShortfall(tx: DbTransaction): Promise<void>;
  setStatus(tx: DbTransaction, staffId: string, status: StaffAccount["status"]): Promise<void>;
  setRole(tx: DbTransaction, staffId: string, role: StaffAccount["role"]): Promise<void>;
  /**
   * An Admin's "Reset password" begins (S01.08): the account is held at `locked_pending_reissue`
   * with `must_change_password`, so neither its old password nor a half-finished reset signs in.
   * Only an `active` or `locked_pending_reissue` account. True when it changed.
   */
  beginPasswordReset(tx: DbTransaction, staffId: string, at: Date): Promise<boolean>;
  /** The account's revocation count (staff_account.session_generation, S01.08), or null when there is no such account. */
  sessionGeneration(db: DbExecutor, staffId: string): Promise<number | null>;
  /** Adds one to the account's revocation count. */
  bumpSessionGeneration(tx: DbTransaction, staffId: string): Promise<void>;
}

/** A lock started by failed sign-ins: one username, or one client. */
export type ThrottleKind = "username" | "client";

/** Port: the failed-sign-in throttle's tables (sign_in_failure, sign_in_lock), keyed by hashes only. */
export interface ThrottleStore {
  /** Serialises sign-in decisions on these keys until the transaction ends (taken in a fixed order). */
  lockKeys(tx: DbTransaction, keyHashes: string[]): Promise<void>;
  /** The latest end of any lock on these keys, or null. */
  lockedUntil(db: DbExecutor, keys: { kind: ThrottleKind; keyHash: string }[]): Promise<Date | null>;
  /** Stores one failure and returns the failures in each window, this one included. */
  recordFailure(
    tx: DbTransaction,
    failure: { at: Date; usernameHash: string; clientHash: string },
    windowsStart: { username: Date; client: Date },
  ): Promise<{ username: number; client: number }>;
  /** Starts or extends a lock (never shortens one). */
  setLock(tx: DbTransaction, kind: ThrottleKind, keyHash: string, until: Date): Promise<void>;
  /** Deletes failures and ended locks older than `before`. */
  purge(tx: DbTransaction, before: Date): Promise<void>;
}

/** A staff session the app opened (staff_session). */
export interface StaffSessionRecord {
  /** The session's key (SessionUser.sessionKey). */
  id: string;
  staffId: string;
  createdAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
}

/**
 * Port: the staff sessions the app opened (staff_session, S01.07). A request is signed in only
 * when its verified session has an unrevoked row here, and only sign-in adds rows. S01.08 builds
 * the idle and absolute limits on `createdAt` and `lastSeenAt`, and revokes with `revokeAll`.
 */
export interface StaffSessionStore {
  /** Records a session sign-in just opened (created and last seen at `at`). */
  insert(tx: DbTransaction, session: { id: string; staffId: string; at: Date }): Promise<void>;
  /** The session with this key, revoked or not; null when the app never opened it. */
  find(db: DbExecutor, id: string): Promise<StaffSessionRecord | null>;
  /** Records a request on the session (at most one write a minute; a revoked session is left as it is). */
  touch(db: DbExecutor, id: string, at: Date): Promise<void>;
  /**
   * Replaces a session by another for the same account (the provider opened a new session for the
   * same browser): the new one keeps the old one's `createdAt`, and the old one is revoked.
   */
  replace(tx: DbTransaction, from: string, to: { id: string; staffId: string; at: Date }): Promise<void>;
  /** Revokes one session. True when it was open. */
  revoke(db: DbExecutor, id: string, at: Date): Promise<boolean>;
  /** Revokes every open session of the account, except `keep` when given. Returns how many it revoked. */
  revokeAll(db: DbExecutor, staffId: string, at: Date, options?: { keep?: string }): Promise<number>;
}

/** Port: the operational log (structured, no personal data). */
export interface OperationalLog {
  error(evt: string, fields: Record<string, string | number | boolean | null>): void;
  /** Something the owner should fix that does not stop the request (for example a setting). */
  warn(evt: string, fields: Record<string, string | number | boolean | null>): void;
}
