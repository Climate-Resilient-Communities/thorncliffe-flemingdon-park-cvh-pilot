import { createHmac } from "node:crypto";
import type { AssuranceLevel, SetupGate } from "../../../contracts/staffAuth";
import type { StaffRole } from "../../../contracts/staffRoles";
import type { Db, DbExecutor, DbTransaction } from "../../../platform/db";
import { SYSTEM_ACTOR, type REFUSAL_REASONS } from "../../audit";
import { actorCan } from "../domain/accountAuthority";
import type { PrivilegedAction } from "../domain/assurance";
import { normaliseAuthenticatorCode } from "../domain/authenticatorCode";
import { bootstrapPhase, decideUnderBootstrap } from "../domain/bootstrap";
import { isUsernameFormat, loginForUsername, normaliseUsername } from "../domain/newAccount";
import { validateOwnPassword, type OwnPasswordError } from "../domain/ownPassword";
import { err, ok, type Result } from "../domain/result";
import { sessionStanding } from "../domain/sessionLimits";
import { needsAuthenticator, setupGate } from "../domain/setupGate";
import { CLIENT_LIMIT, THROTTLE_RETENTION_MS, USERNAME_LIMIT, isLocked, lockAfterFailure } from "../domain/signInThrottle";
import type { StaffAccount } from "../domain/staffAccount";
import { deriveStartingPassword } from "../domain/startingPassword";
import { startingPasswordStanding } from "../domain/startingPasswordWindow";
import type { AuditWriter } from "./accounts";
import type { AuthSessions, FactorEnrolment, IdentityProvider, OperationalLog, PasswordCheck, StaffSessionStore, StaffStore, ThrottleStore } from "./ports";
import { DEFAULT_LOCK_TIMEOUT_MS, adminShortfallMeta, type AdminRecovery } from "./adminRecovery";
import { PEPPER_NOT_CONFIGURED_EVENT, type PasswordPepper } from "./passwordPepper";
import { hasEnrolledAuthenticator, type SignInLockReader } from "./usability";

type AuditReason = (typeof REFUSAL_REASONS)[number];

export interface StaffAuthDeps {
  db: Db;
  store: StaffStore;
  throttle: ThrottleStore;
  /** The staff sessions the app opened (staff_session). */
  sessionStore: StaffSessionStore;
  /** What the provider stores for a password (passwordPepper.ts); null when STAFF_PASSWORD_PEPPER is not configured. */
  pepper: PasswordPepper | null;
  idp: IdentityProvider;
  audit: AuditWriter;
  log: OperationalLog;
  now: () => Date;
  /**
   * The server-only key of the throttle's hashes (HMAC-SHA-256). Usernames and client addresses are
   * stored only as these hashes, so the tables cannot be read back into who tried to sign in or
   * from where.
   */
  throttleKey: string;
  /** Ends bootstrap when both pending Admins are usable (S01.05's AccountService). */
  completeBootstrapIfReady: (actorId: string) => Promise<boolean>;
  /**
   * S01.06's recovery exception, called in an automatic lock's transaction before the account
   * changes: the lock always goes ahead, and the result says whether it leaves fewer than two
   * usable Admins (`admin_shortfall` on its audit record).
   */
  beginAdminRecovery: (tx: DbTransaction, targetId: string) => Promise<AdminRecovery>;
  /**
   * Timing of refused sign-ins (test seams): every refusal takes at least `minRefusalMs` (default
   * MIN_REFUSAL_MS), measured on `monotonicMs` (default performance.now) and waited with `sleep`.
   */
  minRefusalMs?: number;
  /** How long a password change or re-issue waits for the account's row lock (default DEFAULT_LOCK_TIMEOUT_MS). */
  lockTimeoutMs?: number;
  monotonicMs?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The least time a refused sign-in takes. Refusals take different paths (no account to look up,
 * a lock read, a failure recorded in a transaction, an audit, the S01.06 recovery check), so their
 * own durations would tell an unknown username from a known one; every refusal is padded to this,
 * which is above what any of those paths takes.
 */
export const MIN_REFUSAL_MS = 700;

/** Supabase's JWT expiry the staff session relies on: the access token is the whole 12-hour session. */
export const REQUIRED_TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/** The signed-in staff member of a request, with the gate of the setup sequence they are at. */
export interface StaffSession {
  staffId: string;
  username: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  gate: SetupGate;
  /** The staff_session id of this request's session (S01.08 limits and revokes it). */
  sessionId: string;
  /**
   * The session's authenticator level (S01.10): `aal2` only when the provider's verified token says
   * so AND the app recorded that this session reached it through its own code check (staff_session.aal2_at).
   */
  aal: AssuranceLevel;
}

export type SignInOutcome =
  | { ok: true; staffId: string; gate: SetupGate }
  /** Always the same generic message: never says whether the username exists or why. */
  | { ok: false; error: "sign_in_failed" }
  /** The right starting password, unused for 24 hours (or already used once). */
  | { ok: false; error: "starting_password_expired" }
  /** The identity provider could not be reached; nothing was counted. */
  | { ok: false; error: "unavailable" };

export type ChangePasswordError = OwnPasswordError | "password_rejected" | "provider_error" | "not_required";

/** Why an authenticator code was not accepted (S01.10). */
export type AuthenticatorCodeError =
  /** Not six digits, or not the code of the authenticator (counted as a failed sign-in when checked). */
  | "code_invalid"
  /** Too many wrong codes or passwords: the username or the client is locked for now. */
  | "code_locked"
  /** The person is not at a gate that takes a code (or their account changed meanwhile). */
  | "not_required"
  /** The provider could not be reached or failed. */
  | "provider_error";

/** Why an enrolment could not start (S01.10). */
export type StartEnrolmentError = "not_required" | "provider_error";

/** The issuer an authenticator app shows next to the code. */
export const AUTHENTICATOR_ISSUER = "CVH Hub";

export type ReissueError = "forbidden" | "bootstrap_incomplete" | "not_found" | "not_reissuable" | "provider_error" | "passwords_not_configured";

/**
 * Why IT's re-issue of the first Admin's starting password (scripts/create-first-admin --reissue)
 * was refused: bootstrap has not started or has ended, the username is not the first Admin's, or
 * the first Admin is not pending on a starting password (chose their own, or suspended or removed).
 */
export type FirstAdminReissueError =
  | "bootstrap_not_in_progress"
  | "not_first_admin"
  | "not_reissuable"
  | "provider_error"
  | "passwords_not_configured";

/** Why a checked attempt failed, as the audit records it. */
type FailureReason = Extract<AuditReason, "wrong_password" | "unknown_username" | "forbidden" | "wrong_code">;

/** The throttle's keyed hash of a username or a client address (HMAC-SHA-256, hex). */
export function throttleHash(throttleKey: string, purpose: "username" | "client", value: string): string {
  return createHmac("sha256", throttleKey).update(`cvh:sign-in:${purpose}:${value}`).digest("hex");
}

/**
 * Reads the failed-sign-in lock of a username: its end while in force, else null. One of the facts
 * of isUsableAdmin (S01.05's bootstrap completion; S01.06 and S01.14 use it too).
 */
export function signInLockReader(deps: { throttle: ThrottleStore; throttleKey: string; now: () => Date }): SignInLockReader {
  return async (executor: DbExecutor, username: string): Promise<Date | null> => {
    const keyHash = throttleHash(deps.throttleKey, "username", normaliseUsername(username));
    const until = await deps.throttle.lockedUntil(executor, [{ kind: "username", keyHash }]);
    return isLocked(until, deps.now()) ? until : null;
  };
}

export function createStaffAuthService(deps: StaffAuthDeps) {
  const { db, store, throttle, idp, audit, log, sessionStore } = deps;
  const minRefusalMs = deps.minRefusalMs ?? MIN_REFUSAL_MS;
  const monotonicMs = deps.monotonicMs ?? (() => performance.now());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // The JWT expiry warning is logged once per process: the composition root builds this service once.
  let tokenLifetimeWarned = false;

  const keyed = (purpose: "username" | "client", value: string) => throttleHash(deps.throttleKey, purpose, value);

  const throttleKeys = (usernameHash: string, clientHash: string) => [
    { kind: "username" as const, keyHash: usernameHash },
    { kind: "client" as const, keyHash: clientHash },
  ];

  async function throttled(executor: DbExecutor, usernameHash: string, clientHash: string, now: Date) {
    return isLocked(await throttle.lockedUntil(executor, throttleKeys(usernameHash, clientHash)), now);
  }

  /** The pepper, or null after logging that staff passwords are not configured (the caller refuses). */
  function pepperFor(operation: string): PasswordPepper | null {
    if (deps.pepper) return deps.pepper;
    log.error(PEPPER_NOT_CONFIGURED_EVENT, { operation });
    return null;
  }

  const subject = (account: StaffAccount | null) => ({
    actorStaffId: account ? account.id : SYSTEM_ACTOR,
    subjectType: "staff_account",
    subjectId: account ? account.id : null,
  });

  /** An attempt refused without checking the password: the username or the client is locked. */
  async function refuseThrottled(account: StaffAccount | null): Promise<SignInOutcome> {
    await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "throttled" } });
    return { ok: false, error: "sign_in_failed" };
  }

  const windowsStartAt = (now: Date) => ({ username: new Date(now.getTime() - USERNAME_LIMIT.windowMs), client: new Date(now.getTime() - CLIENT_LIMIT.windowMs) });

  /**
   * Starts the username lock and the client block a failure count reaches (inside the transaction
   * holding the keys' locks). When `startsAccountLock` and the count reaches the username limit, a
   * known account's lock is an automatic lock: S01.06's recovery exception, then the lock, with
   * `auth.locked` audited.
   */
  async function applyLimits(
    tx: DbTransaction,
    account: StaffAccount | null,
    usernameHash: string,
    clientHash: string,
    inWindow: { username: number; client: number },
    now: Date,
    startsAccountLock: boolean,
  ) {
    const usernameLock = lockAfterFailure(inWindow.username, USERNAME_LIMIT, now);
    const clientLock = lockAfterFailure(inWindow.client, CLIENT_LIMIT, now);
    const recovery = startsAccountLock && usernameLock !== null && account ? await deps.beginAdminRecovery(tx, account.id) : null;
    if (usernameLock) await throttle.setLock(tx, "username", usernameHash, usernameLock);
    if (clientLock) await throttle.setLock(tx, "client", clientHash, clientLock);
    if (recovery && account) {
      await audit.record(tx, {
        action: "auth.locked",
        actorStaffId: SYSTEM_ACTOR,
        subjectType: "staff_account",
        subjectId: account.id,
        meta: { lock: "failed_sign_in", ...adminShortfallMeta(recovery) },
      });
    }
  }

  /**
   * A checked attempt failed: stores it, starts the username lock or the client block when this
   * failure reaches a limit, and audits `auth.failed` (and `auth.locked` when a known account's
   * username is locked). Serialised per username and per client, so concurrent failures are each
   * counted once and the lock starts at exactly the failure that reaches the limit.
   */
  async function recordFailure(account: StaffAccount | null, usernameHash: string, clientHash: string, reason: FailureReason, now: Date) {
    const counts = await db.transaction(async (tx) => {
      await throttle.lockKeys(tx, [usernameHash, clientHash]);
      await throttle.purge(tx, new Date(now.getTime() - THROTTLE_RETENTION_MS));
      const inWindow = await throttle.recordFailure(tx, { at: now, usernameHash, clientHash }, windowsStartAt(now));
      await applyLimits(tx, account, usernameHash, clientHash, inWindow, now, inWindow.username === USERNAME_LIMIT.failures);
      return inWindow;
    });
    await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason, attempts: counts.username } });
    return { ok: false, error: "sign_in_failed" } as const;
  }

  /**
   * The right starting password, but expired (unused 24 hours after issue) or already used:
   * an active account becomes `locked_pending_reissue` (expiry only) with `auth.locked` audited;
   * otherwise the attempt is audited as `auth.failed`.
   */
  async function refuseStartingPassword(account: StaffAccount, standing: "expired" | "used"): Promise<SignInOutcome> {
    const locked =
      standing === "expired" &&
      (await db.transaction(async (tx) => {
        const recovery = await deps.beginAdminRecovery(tx, account.id);
        if (!(await store.lockPendingReissue(tx, account.id))) return false;
        await audit.record(tx, {
          action: "auth.locked",
          actorStaffId: SYSTEM_ACTOR,
          subjectType: "staff_account",
          subjectId: account.id,
          meta: { lock: "expired_starting_password", reason: "expired_starting_password", ...adminShortfallMeta(recovery) },
        });
        return true;
      }));
    if (!locked) {
      await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "expired_starting_password" } });
    }
    return { ok: false, error: "starting_password_expired" };
  }

  /**
   * The gate of an account. `providerEnrolled`: the provider holds a verified factor for it; the
   * authenticator counts only when the app enrolled it too (factor_enrolled_at, S01.10).
   */
  function gateOf(account: StaffAccount, providerEnrolled: boolean, aal: AssuranceLevel): SetupGate {
    const authenticatorEnrolled = account.factorEnrolledAt !== null && providerEnrolled;
    return setupGate({ mustChangePassword: account.mustChangePassword, role: account.role, authenticatorEnrolled, aal });
  }

  /** Logs once per process when the provider's access tokens last less than the 12-hour session. */
  function checkTokenLifetime(seconds: number | null) {
    if (tokenLifetimeWarned || (seconds !== null && seconds >= REQUIRED_TOKEN_LIFETIME_SECONDS)) return;
    tokenLifetimeWarned = true;
    log.warn("identity.jwt_expiry_short", { lifetime_seconds: seconds, required_seconds: REQUIRED_TOKEN_LIFETIME_SECONDS });
  }

  /** Sign-in without the timing pad (see signIn). */
  async function attemptSignIn(sessions: AuthSessions, input: { username: string; password: string; client: string }): Promise<SignInOutcome> {
    const pepper = pepperFor("sign_in");
    if (!pepper) return { ok: false, error: "sign_in_failed" };
    const now = deps.now();
    const username = normaliseUsername(input.username);
    const usernameHash = keyed("username", username);
    const clientHash = keyed("client", input.client);
    const plausible = isUsernameFormat(username) && input.password !== "";
    const account = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;

    if (await throttled(db, usernameHash, clientHash, now)) return refuseThrottled(account);

    // The provider is asked for an unknown username too, but that alone does not make the answers
    // take as long: the paths after it differ (an account or none, a recovery check, a lock). The
    // timing is evened out by signIn, which pads every refusal to MIN_REFUSAL_MS.
    // S01.08: the account's revocation count before the password is checked. A revocation that
    // lands after this (a password reset, a suspension) refuses this sign-in below.
    const generation = account ? await store.sessionGeneration(db, account.id) : null;
    const check = plausible ? await sessions.checkPassword({ login: loginForUsername(username), password: pepper(input.password) }) : null;
    if (check && !check.ok && check.error === "unavailable") {
      log.error("identity.sign_in_unavailable", { has_account: account !== null });
      await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "provider_error" } });
      return { ok: false, error: "unavailable" };
    }
    if (!check || !check.ok) return recordFailure(account, usernameHash, clientHash, account ? "wrong_password" : "unknown_username", now);

    // The password is right. Refuse anything but an active account that may use it.
    if (!account || account.authUserId !== check.authUserId || account.status === "suspended" || account.status === "removed") {
      await check.discard();
      return recordFailure(account, usernameHash, clientHash, "forbidden", now);
    }
    const standing = startingPasswordStanding(account, now);
    if (standing === "expired" || standing === "used") {
      await check.discard();
      return refuseStartingPassword(account, standing);
    }
    if (account.status !== "active") {
      await check.discard();
      return recordFailure(account, usernameHash, clientHash, "forbidden", now);
    }

    // Accept under the same serialisation as failures: a lock that a concurrent failure started
    // while the password was being checked still refuses this attempt. The session is recorded in
    // the same transaction: only a session recorded here is ever accepted (currentSession).
    const decision = await db.transaction(async (tx) => {
      await throttle.lockKeys(tx, [usernameHash, clientHash]);
      if (await throttled(tx, usernameHash, clientHash, now)) return "throttled" as const;
      const current = await store.lockAccount(tx, account.id);
      if (!current || current.status !== "active") return "forbidden" as const;
      if ((await store.sessionGeneration(tx, current.id)) !== generation) return "revoked" as const;
      const currentStanding = startingPasswordStanding(current, now);
      if (currentStanding === "expired" || currentStanding === "used") return currentStanding;
      if (currentStanding === "valid") await store.markStartingPasswordUsed(tx, current.id, now);
      await sessionStore.insert(tx, { id: check.sessionKey, staffId: current.id, at: now });
      await audit.record(tx, { action: "auth.signed_in", actorStaffId: current.id, subjectType: "staff_account", subjectId: current.id, meta: { aal: "aal1" } });
      // The throttle's old rows go on a success too (and hourly, by the purge job).
      await throttle.purge(tx, new Date(now.getTime() - THROTTLE_RETENTION_MS));
      return { account: current };
    });
    if (decision === "throttled") {
      await check.discard();
      return refuseThrottled(account);
    }
    if (decision === "forbidden") {
      await check.discard();
      return recordFailure(account, usernameHash, clientHash, "forbidden", now);
    }
    if (decision === "revoked") {
      // The account's sessions were revoked while the password was checked: it may have been the
      // old password. Not counted as a failure; the person signs in again.
      await check.discard();
      await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "conflict" } });
      return { ok: false, error: "sign_in_failed" };
    }
    if (decision === "expired" || decision === "used") {
      await check.discard();
      return refuseStartingPassword(account, decision);
    }
    await check.accept();
    checkTokenLifetime(check.tokenLifetimeSeconds);
    // A new session is aal1: Admins and Coordinators enter their code next (S01.10).
    const enrolled = decision.account.mustChangePassword || !needsAuthenticator(decision.account.role) ? false : await hasEnrolledAuthenticator(idp, decision.account);
    return { ok: true, staffId: decision.account.id, gate: gateOf(decision.account, enrolled, "aal1") };
  }

  /**
   * After a password change the provider has ended every session of the user (setPassword), this
   * browser's too: a new session is opened for it with the new password and takes the old one's
   * place in staff_session (keeping its start, for S01.08's absolute limit). If that fails, the
   * person is signed out and signs in again with the new password.
   */
  async function reopenSession(account: StaffAccount, current: CurrentSession, providerPassword: string, now: Date) {
    let check: PasswordCheck;
    try {
      check = await current.sessions.checkPassword({ login: loginForUsername(account.username), password: providerPassword });
    } catch {
      check = { ok: false, error: "unavailable" };
    }
    if (check.ok && check.authUserId === account.authUserId) {
      const opened = check;
      await db.transaction((tx) => sessionStore.replace(tx, current.sessionId, { id: opened.sessionKey, staffId: account.id, at: now }));
      await opened.accept();
      return;
    }
    if (check.ok) await check.discard();
    log.error("identity.session_not_reopened", { staff_id: account.id });
    await sessionStore.revoke(db, current.sessionId, now);
    await current.sessions.signOut();
  }

  /**
   * Re-issues a starting password (an Admin's re-issue, or IT's for the first Admin), serialised
   * with every other password change of the account. Inside one transaction: the lock timeout is
   * set, `beforeLock` takes any wider lock the caller needs, the account row is locked (FOR UPDATE:
   * "choose your password" takes the same lock), the account is checked again under the lock (still
   * on a starting password, active or locked_pending_reissue) and so is `stillAllowed`, and only
   * then is the password set at the provider (which ends every provider session of the account).
   * The database changes follow and commit with it, so the other operation never sees a half-done
   * one; if the provider fails, nothing is written. Every session is revoked and `password.reissued`
   * audited.
   *
   * Lock order (no deadlock with S01.05/S01.06): accounts advisory lock 7315420052 (first-Admin
   * re-issue only), then this one account row. S01.06 takes Admin rows in id order, all at once and
   * never an account's row after the advisory lock; nothing here takes a second row.
   */
  async function reissue(
    target: StaffAccount,
    providerPassword: string,
    actorStaffId: string | null,
    beforeLock: (tx: DbTransaction) => Promise<void>,
    stillAllowed: (tx: DbTransaction) => Promise<boolean>,
  ): Promise<"reissued" | "provider_error" | "conflict"> {
    return db.transaction(async (tx) => {
      await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
      await beforeLock(tx);
      const locked = await store.lockAccount(tx, target.id);
      if (!locked || !locked.mustChangePassword || (locked.status !== "active" && locked.status !== "locked_pending_reissue")) return "conflict" as const;
      if (!(await stillAllowed(tx))) return "conflict" as const;
      const set = await idp.setPassword(locked.authUserId, providerPassword);
      if (!set.ok) {
        log.error("identity.password_not_reissued", { staff_id: target.id, error: set.error });
        return "provider_error" as const;
      }
      const now = deps.now();
      if (!(await store.reissueStartingPassword(tx, target.id, now))) throw new Error("re-issue not recorded under the account lock");
      // One count of revocations covers every way a starting password is issued again (a re-issue
      // here, an Admin's reset): "choose your password" refuses if it moved since the request began.
      await store.bumpSessionGeneration(tx, target.id);
      await sessionStore.revokeAll(tx, target.id, now);
      await audit.record(tx, { action: "password.reissued", actorStaffId, subjectType: "staff_account", subjectId: target.id });
      return "reissued" as const;
    });
  }

  return {
    /**
     * Sign-in by username and password (S01.07). Locked usernames and clients are refused before the
     * password is checked. The provider is given the peppered password, never the typed one. The
     * provider's session is kept only when the sign-in is accepted, and recorded in staff_session;
     * every refusal discards it. Failures are counted and audited; the person sees one generic
     * message, except for the right starting password after it expired. Every refusal takes at
     * least MIN_REFUSAL_MS, so its duration does not tell whether the username exists.
     */
    async signIn(sessions: AuthSessions, input: { username: string; password: string; client: string }): Promise<SignInOutcome> {
      const started = monotonicMs();
      const outcome = await attemptSignIn(sessions, input);
      if (!outcome.ok) {
        const remaining = minRefusalMs - (monotonicMs() - started);
        if (remaining > 0) await sleep(remaining);
      }
      return outcome;
    },

    /**
     * The server-side session lookup of every staff request (AD-4): the provider verifies the
     * session, the app checks that it opened that session itself (an unrevoked staff_session row
     * for this account), then the staff_account is loaded and the request is rejected unless its
     * status is `active` (a starting password still in use is an `active` account at gate 1) and,
     * on a starting password, that password has not expired. S01.08 adds the session limits of the
     * account's role (sessionLimits.ts: 30 minutes idle for Ambassadors, 12 hours for everyone),
     * measured on the row's created_at and last_seen_at; an expired session is revoked. A rejected
     * session is signed out (ended at the provider, its cookie cleared where the response can
     * still set cookies). Returns null for no session and every rejection.
     */
    async currentSession(sessions: AuthSessions): Promise<StaffSession | null> {
      const user = await sessions.currentUser();
      if (!user) return null;
      const now = deps.now();
      const account = await store.findByAuthUserId(db, user.authUserId);
      const opened = await sessionStore.find(db, user.sessionKey);
      // A session opened at the provider directly (a password grant outside signIn) has no row.
      const bound = opened !== null && opened.revokedAt === null && account !== null && opened.staffId === account.id;
      const usable =
        bound && account.status === "active" && !(account.mustChangePassword && startingPasswordStanding(account, now) === "expired");
      if (!usable || !opened || !account) {
        await sessions.signOut();
        return null;
      }
      // S01.08: the session limits of the account's current role. An ended session is revoked, so
      // it stays ended whatever changes later (a new role, a clock moved back).
      if (sessionStanding(opened, account.role, now) !== "active") {
        await sessionStore.revoke(db, opened.id, now);
        await sessions.signOut();
        return null;
      }
      await sessionStore.touch(db, opened.id, now);
      // S01.10: aal2 needs both the provider's verified token and the app's record that this session
      // reached it through the app's code check; a session raised at the provider directly stays aal1.
      const aal: AssuranceLevel = user.aal === "aal2" && opened.aal2At !== null ? "aal2" : "aal1";
      return {
        staffId: account.id,
        username: account.username,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        gate: gateOf(account, user.authenticatorEnrolled, aal),
        sessionId: opened.id,
        aal,
      };
    },

    /** Revokes the request's session, ends it at the provider and clears its cookies. Never throws. */
    async signOut(sessions: AuthSessions): Promise<void> {
      try {
        const user = await sessions.currentUser();
        if (user) await sessionStore.revoke(db, user.sessionKey, deps.now());
      } catch (error) {
        log.error("identity.sign_out_not_recorded", { error: error instanceof Error ? error.constructor.name : "unknown" });
      }
      await sessions.signOut();
    },

    /**
     * "Choose your password" (gate 1): checks the own-password rules, replaces the password at the
     * provider (the starting password stops working at once, and every provider session ends),
     * clears `must_change_password`, revokes the account's other staff sessions and audits
     * `password.changed` in the same transaction, then reopens the session of the request it came
     * from (`current`) and returns the next gate. Without `current` every session is revoked.
     */
    async changePassword(
      staffId: string,
      input: { password: string; confirm: string },
      current?: CurrentSession,
    ): Promise<Result<{ gate: SetupGate }, ChangePasswordError>> {
      // Read before the account, so a reset or re-issue in between can only make the check below refuse.
      const generation = await store.sessionGeneration(db, staffId);
      const account = await store.findById(db, staffId);
      const refuse = async (code: ChangePasswordError, reason: AuditReason) => {
        await audit.recordRefusal(db, { action: "password.changed", actorStaffId: staffId, subjectType: "staff_account", subjectId: staffId, meta: { reason } });
        return err(code);
      };
      if (!account || account.status !== "active" || !account.mustChangePassword) return refuse("not_required", "conflict");
      const starting = deriveStartingPassword(account.firstName, account.lastName);
      const valid = validateOwnPassword(input, { username: account.username, startingPassword: starting.ok ? starting.value : null });
      if (!valid.ok) return refuse(valid.error, "validation");
      const pepper = pepperFor("change_password");
      if (!pepper) return refuse("provider_error", "provider_error");

      const providerPassword = pepper(valid.value);
      const now = deps.now();
      // Serialised with a re-issue of the same account (see reissue for the lock order): lock the
      // account row, check again under it, and only then set the password at the provider.
      const outcome = await db.transaction(async (tx) => {
        await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
        const locked = await store.lockAccount(tx, staffId);
        if (!locked || locked.status !== "active" || !locked.mustChangePassword) return { done: false as const, error: "not_required" as const };
        // Still the starting password this request read: a re-issue or reset since then started a new one.
        if (locked.startingPasswordIssuedAt?.getTime() !== account.startingPasswordIssuedAt?.getTime()) return { done: false as const, error: "not_required" as const };
        // Nor any revocation (an Admin's reset, a re-issue) since the request began: it may have issued
        // the same starting password again within the same millisecond.
        if ((await store.sessionGeneration(tx, staffId)) !== generation) return { done: false as const, error: "not_required" as const };
        if (current) {
          // A re-issue (or a suspension) meanwhile revoked the session this request came from.
          const opened = await sessionStore.find(tx, current.sessionId);
          if (!opened || opened.revokedAt !== null || opened.staffId !== staffId) return { done: false as const, error: "not_required" as const };
        }
        const set = await idp.setPassword(locked.authUserId, providerPassword);
        if (!set.ok) {
          if (set.error === "unavailable") log.error("identity.password_not_set", { staff_id: staffId });
          return { done: false as const, error: set.error === "rejected" ? ("password_rejected" as const) : ("provider_error" as const) };
        }
        if (!(await store.completePasswordChange(tx, staffId, locked.startingPasswordIssuedAt))) throw new Error("password change not recorded under the account lock");
        await sessionStore.revokeAll(tx, staffId, now, { keep: current?.sessionId });
        await audit.record(tx, { action: "password.changed", actorStaffId: staffId, subjectType: "staff_account", subjectId: staffId });
        return { done: true as const };
      });
      if (!outcome.done) return refuse(outcome.error, outcome.error === "not_required" ? "conflict" : "provider_error");
      if (current) await reopenSession(account, current, providerPassword, now);
      if (account.role === "admin") await deps.completeBootstrapIfReady(staffId);
      const enrolled = needsAuthenticator(account.role) && (await hasEnrolledAuthenticator(idp, account));
      return ok({ gate: gateOf({ ...account, mustChangePassword: false }, enrolled, "aal1") });
    },

    /**
     * An Admin re-issues a starting password that expired or was used without being replaced: the
     * provider's password is set to the starting password again (which ends every provider session
     * of the account), every staff session of the account is revoked, the account is active again
     * and a new 24-hour window starts. Audited as `password.reissued`. Not for someone who already
     * chose their own password (that is S01.08's "Reset password").
     */
    async reissueStartingPassword(actorId: string, usernameInput: string): Promise<Result<{ username: string; startingPassword: string }, ReissueError>> {
      const actor = await store.findById(db, actorId);
      const refuse = async (code: ReissueError, reason: AuditReason, subjectId: string | null) => {
        await audit.recordRefusal(db, { action: "password.reissued", actorStaffId: actor ? actor.id : null, subjectType: "staff_account", subjectId, meta: { reason } });
        return err(code);
      };
      if (!actor || !actorCan(actor, "accounts.manage")) return refuse("forbidden", "forbidden", null);
      const username = normaliseUsername(usernameInput);
      const target = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;
      if (!target) return refuse("not_found", "not_found", null);
      if (!target.mustChangePassword || (target.status !== "active" && target.status !== "locked_pending_reissue")) {
        return refuse("not_reissuable", "conflict", target.id);
      }
      const decision = decideUnderBootstrap(await store.readBootstrap(db), actor.id, { kind: "reissue_starting_password", targetId: target.id });
      if (!decision.ok) return refuse("bootstrap_incomplete", "bootstrap_incomplete", target.id);
      const starting = deriveStartingPassword(target.firstName, target.lastName);
      if (!starting.ok) return refuse("not_reissuable", "validation", target.id);
      const pepper = pepperFor("reissue_starting_password");
      if (!pepper) return refuse("passwords_not_configured", "provider_error", target.id);

      const result = await reissue(target, pepper(starting.value), actor.id, async () => {}, async (tx) => {
        const current = await store.findById(tx, actor.id);
        return current !== null && actorCan(current, "accounts.manage");
      });
      if (result !== "reissued") return refuse(result === "provider_error" ? "provider_error" : "not_reissuable", result, target.id);
      return ok({ username: target.username, startingPassword: starting.value });
    },

    /**
     * IT's way out of a first-Admin lockout (scripts/create-first-admin --reissue): while bootstrap
     * is in progress, and only for the first Admin while they are still on a starting password
     * (active or `locked_pending_reissue`), issues the starting password again with a new 24-hour
     * window, revokes every session of the account (at the provider too) and audits
     * `password.reissued` with the system as actor. Refused in every other state.
     */
    async reissueFirstAdminStartingPassword(usernameInput: string): Promise<Result<{ username: string; startingPassword: string }, FirstAdminReissueError>> {
      const refuse = async (code: FirstAdminReissueError, reason: AuditReason, subjectId: string | null) => {
        await audit.recordRefusal(db, { action: "password.reissued", actorStaffId: SYSTEM_ACTOR, subjectType: "staff_account", subjectId, meta: { reason } });
        return err(code);
      };
      const state = await store.readBootstrap(db);
      if (state === null || bootstrapPhase(state) !== "in_progress") return refuse("bootstrap_not_in_progress", "conflict", null);
      const username = normaliseUsername(usernameInput);
      const target = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;
      if (!target) return refuse("not_first_admin", "not_found", null);
      if (target.id !== state.firstAdminId) return refuse("not_first_admin", "forbidden", target.id);
      if (!target.mustChangePassword || (target.status !== "active" && target.status !== "locked_pending_reissue")) {
        return refuse("not_reissuable", "conflict", target.id);
      }
      const starting = deriveStartingPassword(target.firstName, target.lastName);
      if (!starting.ok) return refuse("not_reissuable", "validation", target.id);
      const pepper = pepperFor("reissue_first_admin_starting_password");
      if (!pepper) return refuse("passwords_not_configured", "provider_error", target.id);

      const result = await reissue(target, pepper(starting.value), SYSTEM_ACTOR, (tx) => store.lockAccounts(tx), async (tx) => {
        const current = await store.readBootstrap(tx);
        return current !== null && bootstrapPhase(current) === "in_progress" && current.firstAdminId === target.id;
      });
      if (result !== "reissued") return refuse(result === "provider_error" ? "provider_error" : "not_reissuable", result, target.id);
      return ok({ username: target.username, startingPassword: starting.value });
    },

    /** The end of the failed-sign-in lock on this username, if one is in force (an input of isUsableAdmin). */
    signInLockedUntil: signInLockReader(deps),

    /**
     * Gate 2 (S01.10): starts enrolling an authenticator for an Admin or Coordinator who has none.
     * Every factor the provider holds for them is removed first (an unfinished enrolment, or one
     * made at the provider outside the app), so the new one is their only factor; the provider then
     * makes an unverified TOTP factor whose secret is returned to show once. Nothing is recorded
     * until the first code is accepted (verifyAuthenticatorCode).
     */
    async startEnrolment(session: Pick<StaffSession, "staffId" | "gate">, sessions: AuthSessions): Promise<Result<FactorEnrolment, StartEnrolmentError>> {
      const account = await store.findById(db, session.staffId);
      if (!account || account.status !== "active" || account.mustChangePassword || !needsAuthenticator(account.role) || session.gate !== "enrol_authenticator") {
        return err("not_required");
      }
      try {
        await idp.removeFactors(account.authUserId);
      } catch (error) {
        log.error("identity.factors_not_removed", { staff_id: account.id, error: error instanceof Error ? error.constructor.name : "unknown" });
        return err("provider_error");
      }
      const started = await sessions.enrolFactor({ issuer: AUTHENTICATOR_ISSUER, accountName: account.username });
      if (!started.ok) {
        log.error("identity.factor_not_enrolled", { staff_id: account.id, error: started.error });
        return err("provider_error");
      }
      return ok(started.enrolment);
    },

    /**
     * An authenticator code (S01.10): the confirming code of an enrolment (gate 2) or the code of
     * this sign-in (the code gate). Checked by the provider against the person's factor; a right
     * code raises the session to `aal2` there, and the app then records, in one transaction with
     * the account and the session row locked, that this session reached `aal2` (staff_session.aal2_at)
     * and audits `auth.signed_in` with `aal2`, and for an enrolment `factor.enrolled` with the
     * account's factor_enrolled_at set. The session stays `aal2` for the rest of its 12 hours.
     *
     * Wrong codes count as failed sign-ins of the username and the client (S01.07's throttle and
     * locks): 5 within 15 minutes lock the username, so codes cannot be guessed. A code is refused
     * without asking the provider while a lock is in force.
     */
    async verifyAuthenticatorCode(
      session: Pick<StaffSession, "staffId" | "gate" | "sessionId">,
      input: { code: string; client: string },
      sessions: AuthSessions,
    ): Promise<Result<{ gate: SetupGate }, AuthenticatorCodeError>> {
      const account = await store.findById(db, session.staffId);
      const refuse = async (code: AuthenticatorCodeError, reason: AuditReason) => {
        await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason } });
        return err(code);
      };
      const purpose = session.gate === "enrol_authenticator" ? "unverified" : session.gate === "authenticator_code" ? "verified" : null;
      if (!account || purpose === null || account.status !== "active" || account.mustChangePassword || !needsAuthenticator(account.role)) {
        return refuse("not_required", "conflict");
      }
      const code = normaliseAuthenticatorCode(input.code);
      if (code === null) return refuse("code_invalid", "validation");
      const now = deps.now();
      const usernameHash = keyed("username", account.username);
      const clientHash = keyed("client", input.client);
      if (await throttled(db, usernameHash, clientHash, now)) return refuse("code_locked", "throttled");

      // Each code attempt is stored as a pending failure before the provider is asked, under the
      // keys' locks, so attempts fired in parallel are counted too: at most USERNAME_LIMIT.failures
      // reach the provider per window. The row is deleted when the code turns out right (or could
      // not be checked) and stays, as the failure, when it is wrong.
      const reserved = await db.transaction(async (tx) => {
        await throttle.lockKeys(tx, [usernameHash, clientHash]);
        if (await throttled(tx, usernameHash, clientHash, now)) return null;
        const windows = windowsStartAt(now);
        const prior = await throttle.countFailures(tx, { usernameHash, clientHash }, windows);
        if (prior.username >= USERNAME_LIMIT.failures || prior.client >= CLIENT_LIMIT.failures) return null;
        return (await throttle.recordFailure(tx, { at: now, usernameHash, clientHash }, windows)).id;
      });
      if (reserved === null) return refuse("code_locked", "throttled");
      const release = () => db.transaction((tx) => throttle.removeFailure(tx, reserved));

      const checked = await sessions.verifyFactor({ code, factor: purpose });
      if (!checked.ok) {
        if (checked.error === "invalid_code") {
          // The pending failure stays. The locks start here, once: with attempts in flight the count
          // may already include the one that reaches the limit, so a lock in force is not started again.
          const counts = await db.transaction(async (tx) => {
            await throttle.lockKeys(tx, [usernameHash, clientHash]);
            await throttle.purge(tx, new Date(now.getTime() - THROTTLE_RETENTION_MS));
            const inWindow = await throttle.countFailures(tx, { usernameHash, clientHash }, windowsStartAt(now));
            const usernameLocked = isLocked(await throttle.lockedUntil(tx, [{ kind: "username", keyHash: usernameHash }]), now);
            await applyLimits(tx, account, usernameHash, clientHash, inWindow, now, !usernameLocked);
            return inWindow;
          });
          await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "wrong_code", attempts: counts.username } });
          return err("code_invalid");
        }
        await release();
        if (checked.error === "no_factor") return refuse("not_required", "not_found");
        log.error("identity.code_not_checked", { staff_id: account.id });
        return refuse("provider_error", "provider_error");
      }

      const recorded = await db.transaction(async (tx) => {
        // A lock that wrong codes started while this one was being checked still refuses it.
        await throttle.lockKeys(tx, [usernameHash, clientHash]);
        await throttle.removeFailure(tx, reserved);
        if (await throttled(tx, usernameHash, clientHash, now)) return "locked" as const;
        const current = await store.lockAccount(tx, account.id);
        if (!current || current.status !== "active" || current.mustChangePassword || !needsAuthenticator(current.role)) return false;
        // Supabase keeps the session's id when it raises it; if it ever did not, the raised session
        // takes the old one's place (keeping its start for the 12-hour limit).
        if (checked.sessionKey !== session.sessionId) {
          const old = await sessionStore.find(tx, session.sessionId);
          if (!old || old.revokedAt !== null || old.staffId !== current.id) return false;
          await sessionStore.replace(tx, session.sessionId, { id: checked.sessionKey, staffId: current.id, at: now });
        }
        if (!(await sessionStore.markAal2(tx, checked.sessionKey, current.id, now))) return false;
        if (purpose === "unverified") {
          await store.setFactorEnrolled(tx, current.id, now);
          await audit.record(tx, { action: "factor.enrolled", actorStaffId: current.id, subjectType: "staff_account", subjectId: current.id });
        }
        await audit.record(tx, { action: "auth.signed_in", actorStaffId: current.id, subjectType: "staff_account", subjectId: current.id, meta: { aal: "aal2" } });
        return true;
      });
      if (recorded === "locked") {
        await sessions.signOut();
        return refuse("code_locked", "throttled");
      }
      if (!recorded) {
        // Suspended, revoked or given another role while the code was checked: the raised session is not kept.
        await sessions.signOut();
        return refuse("not_required", "conflict");
      }
      await checked.accept();
      // The second Admin's enrolment can be what makes them usable, which ends bootstrap (S01.05).
      if (purpose === "unverified" && account.role === "admin") await deps.completeBootstrapIfReady(account.id);
      return ok({ gate: "hub" });
    },

    /**
     * Audits a privileged staff request refused because its session is below `aal2` (S01.10: 403
     * `aal2_required`). `route` is the route pattern, `permission` the privileged action.
     */
    async refuseBelowAal2(staffId: string, route: string, permission: PrivilegedAction): Promise<void> {
      await audit.recordRefusal(db, {
        action: "permission.denied",
        actorStaffId: staffId,
        subjectType: "staff_account",
        subjectId: staffId,
        meta: { status: 403, route, permission, reason: "aal_required" },
      });
    },

    /**
     * Audits a staff request the role policy refused (S01.12: 403): `forbidden` when the role may
     * never do `permission`, `out_of_scope` when it may but not on this building, floor or entry;
     * or one whose facts the guard could not read (`bad_request`, status 400).
     * `route` is the route pattern, never a value from the request.
     */
    async refuseByPolicy(staffId: string, route: string, permission: string, reason: "forbidden" | "out_of_scope" | "bad_request", status: 403 | 400 = 403): Promise<void> {
      await audit.recordRefusal(db, {
        action: "permission.denied",
        actorStaffId: staffId,
        subjectType: "staff_account",
        subjectId: staffId,
        meta: { status, route, permission, reason },
      });
    },

    /**
     * Audits a staff request refused because the person is at an earlier setup gate (403
     * `setup_incomplete`). `route` is the route pattern, never a value from the request.
     */
    async refuseOutsideGate(staffId: string, route: string): Promise<void> {
      await audit.recordRefusal(db, {
        action: "permission.denied",
        actorStaffId: staffId,
        subjectType: "staff_account",
        subjectId: staffId,
        meta: { status: 403, route, reason: "setup_incomplete" },
      });
    },
  };
}

/** The request a password change comes from: its sessions and its staff_session id. */
export interface CurrentSession {
  sessions: AuthSessions;
  sessionId: string;
}

export type StaffAuthService = ReturnType<typeof createStaffAuthService>;
