import { createHmac } from "node:crypto";
import type { SetupGate } from "../../../contracts/staffAuth";
import type { StaffRole } from "../../../contracts/staffRoles";
import type { Db, DbExecutor } from "../../../platform/db";
import { SYSTEM_ACTOR, type REFUSAL_REASONS } from "../../audit";
import { mayManageAccounts } from "../domain/accountAuthority";
import { decideUnderBootstrap } from "../domain/bootstrap";
import { isUsernameFormat, loginForUsername, normaliseUsername } from "../domain/newAccount";
import { validateOwnPassword, type OwnPasswordError } from "../domain/ownPassword";
import { err, ok, type Result } from "../domain/result";
import { setupGate } from "../domain/setupGate";
import { CLIENT_LIMIT, THROTTLE_RETENTION_MS, USERNAME_LIMIT, isLocked, lockAfterFailure } from "../domain/signInThrottle";
import type { StaffAccount } from "../domain/staffAccount";
import { deriveStartingPassword } from "../domain/startingPassword";
import { startingPasswordStanding } from "../domain/startingPasswordWindow";
import type { AuditWriter } from "./accounts";
import type { AuthSessions, IdentityProvider, OperationalLog, StaffStore, ThrottleStore } from "./ports";

type AuditReason = (typeof REFUSAL_REASONS)[number];

export interface StaffAuthDeps {
  db: Db;
  store: StaffStore;
  throttle: ThrottleStore;
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
}

/** The signed-in staff member of a request, with the gate of the setup sequence they are at. */
export interface StaffSession {
  staffId: string;
  username: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  gate: SetupGate;
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

export type ReissueError = "forbidden" | "bootstrap_incomplete" | "not_found" | "not_reissuable" | "provider_error";

/** Why a checked attempt failed, as the audit records it. */
type FailureReason = Extract<AuditReason, "wrong_password" | "unknown_username" | "forbidden">;

/** The throttle's keyed hash of a username or a client address (HMAC-SHA-256, hex). */
export function throttleHash(throttleKey: string, purpose: "username" | "client", value: string): string {
  return createHmac("sha256", throttleKey).update(`cvh:sign-in:${purpose}:${value}`).digest("hex");
}

/**
 * Reads the failed-sign-in lock of a username: its end while in force, else null. One of the facts
 * of isUsableAdmin (S01.05's bootstrap completion; S01.06 and S01.14 use it too).
 */
export function signInLockReader(deps: { throttle: ThrottleStore; throttleKey: string; now: () => Date }) {
  return async (executor: DbExecutor, username: string): Promise<Date | null> => {
    const keyHash = throttleHash(deps.throttleKey, "username", normaliseUsername(username));
    const until = await deps.throttle.lockedUntil(executor, [{ kind: "username", keyHash }]);
    return isLocked(until, deps.now()) ? until : null;
  };
}

export function createStaffAuthService(deps: StaffAuthDeps) {
  const { db, store, throttle, idp, audit, log } = deps;

  const keyed = (purpose: "username" | "client", value: string) => throttleHash(deps.throttleKey, purpose, value);

  const throttleKeys = (usernameHash: string, clientHash: string) => [
    { kind: "username" as const, keyHash: usernameHash },
    { kind: "client" as const, keyHash: clientHash },
  ];

  async function throttled(executor: DbExecutor, usernameHash: string, clientHash: string, now: Date) {
    return isLocked(await throttle.lockedUntil(executor, throttleKeys(usernameHash, clientHash)), now);
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
      const inWindow = await throttle.recordFailure(
        tx,
        { at: now, usernameHash, clientHash },
        { username: new Date(now.getTime() - USERNAME_LIMIT.windowMs), client: new Date(now.getTime() - CLIENT_LIMIT.windowMs) },
      );
      const usernameLock = lockAfterFailure(inWindow.username, USERNAME_LIMIT, now);
      const clientLock = lockAfterFailure(inWindow.client, CLIENT_LIMIT, now);
      if (usernameLock) await throttle.setLock(tx, "username", usernameHash, usernameLock);
      if (clientLock) await throttle.setLock(tx, "client", clientHash, clientLock);
      if (usernameLock && account && inWindow.username === USERNAME_LIMIT.failures) {
        await audit.record(tx, { action: "auth.locked", actorStaffId: SYSTEM_ACTOR, subjectType: "staff_account", subjectId: account.id, meta: { lock: "failed_sign_in" } });
      }
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
        if (!(await store.lockPendingReissue(tx, account.id))) return false;
        await audit.record(tx, {
          action: "auth.locked",
          actorStaffId: SYSTEM_ACTOR,
          subjectType: "staff_account",
          subjectId: account.id,
          meta: { lock: "expired_starting_password", reason: "expired_starting_password" },
        });
        return true;
      }));
    if (!locked) {
      await audit.recordRefusal(db, { action: "auth.failed", ...subject(account), meta: { reason: "expired_starting_password" } });
    }
    return { ok: false, error: "starting_password_expired" };
  }

  async function gateOf(account: StaffAccount, authenticatorEnrolled: boolean): Promise<SetupGate> {
    return setupGate({ mustChangePassword: account.mustChangePassword, role: account.role, authenticatorEnrolled });
  }

  return {
    /**
     * Sign-in by username and password (S01.07). Locked usernames and clients are refused before the
     * password is checked. The provider's session is kept only when the sign-in is accepted; every
     * refusal discards it. Failures are counted and audited; the person sees one generic message,
     * except for the right starting password after it expired.
     */
    async signIn(sessions: AuthSessions, input: { username: string; password: string; client: string }): Promise<SignInOutcome> {
      const now = deps.now();
      const username = normaliseUsername(input.username);
      const usernameHash = keyed("username", username);
      const clientHash = keyed("client", input.client);
      const plausible = isUsernameFormat(username) && input.password !== "";
      const account = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;

      if (await throttled(db, usernameHash, clientHash, now)) return refuseThrottled(account);

      // The provider is asked even for an unknown username, so the answer takes as long either way.
      const check = plausible ? await sessions.checkPassword({ login: loginForUsername(username), password: input.password }) : null;
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
      // while the password was being checked still refuses this attempt.
      const decision = await db.transaction(async (tx) => {
        await throttle.lockKeys(tx, [usernameHash, clientHash]);
        if (await throttled(tx, usernameHash, clientHash, now)) return "throttled" as const;
        const current = await store.lockAccount(tx, account.id);
        if (!current || current.status !== "active") return "forbidden" as const;
        const currentStanding = startingPasswordStanding(current, now);
        if (currentStanding === "expired" || currentStanding === "used") return currentStanding;
        if (currentStanding === "valid") await store.markStartingPasswordUsed(tx, current.id, now);
        await audit.record(tx, { action: "auth.signed_in", actorStaffId: current.id, subjectType: "staff_account", subjectId: current.id, meta: { aal: "aal1" } });
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
      if (decision === "expired" || decision === "used") {
        await check.discard();
        return refuseStartingPassword(account, decision);
      }
      await check.accept();
      const enrolled = decision.account.mustChangePassword ? false : await idp.hasVerifiedAuthenticator(decision.account.authUserId);
      return { ok: true, staffId: decision.account.id, gate: await gateOf(decision.account, enrolled) };
    },

    /**
     * The server-side session lookup of every staff request (AD-4): the provider verifies the
     * session, then the staff_account is loaded and the request is rejected unless its status is
     * `active` (a starting password still in use is an `active` account at gate 1). Returns null
     * for no session, an unknown auth user and every other status.
     */
    async currentSession(sessions: AuthSessions): Promise<StaffSession | null> {
      const user = await sessions.currentUser();
      if (!user) return null;
      const account = await store.findByAuthUserId(db, user.authUserId);
      if (!account || account.status !== "active") return null;
      return {
        staffId: account.id,
        username: account.username,
        firstName: account.firstName,
        lastName: account.lastName,
        role: account.role,
        gate: await gateOf(account, user.authenticatorEnrolled),
      };
    },

    /** Ends the request's session at the provider and clears its cookies. */
    async signOut(sessions: AuthSessions): Promise<void> {
      await sessions.signOut();
    },

    /**
     * "Choose your password" (gate 1): checks the own-password rules, replaces the password at the
     * provider (the starting password stops working at once), clears `must_change_password` and
     * audits `password.changed` in the same transaction, then returns the next gate.
     */
    async changePassword(staffId: string, input: { password: string; confirm: string }): Promise<Result<{ gate: SetupGate }, ChangePasswordError>> {
      const account = await store.findById(db, staffId);
      const refuse = async (code: ChangePasswordError, reason: AuditReason) => {
        await audit.recordRefusal(db, { action: "password.changed", actorStaffId: staffId, subjectType: "staff_account", subjectId: staffId, meta: { reason } });
        return err(code);
      };
      if (!account || account.status !== "active" || !account.mustChangePassword) return refuse("not_required", "conflict");
      const starting = deriveStartingPassword(account.firstName, account.lastName);
      const valid = validateOwnPassword(input, { username: account.username, startingPassword: starting.ok ? starting.value : null });
      if (!valid.ok) return refuse(valid.error, "validation");

      const set = await idp.setPassword(account.authUserId, valid.value);
      if (!set.ok) {
        if (set.error === "unavailable") log.error("identity.password_not_set", { staff_id: staffId });
        return refuse(set.error === "rejected" ? "password_rejected" : "provider_error", "provider_error");
      }
      const changed = await db.transaction(async (tx) => {
        if (!(await store.completePasswordChange(tx, staffId))) return false;
        await audit.record(tx, { action: "password.changed", actorStaffId: staffId, subjectType: "staff_account", subjectId: staffId });
        return true;
      });
      if (!changed) {
        // Suspended or re-issued meanwhile: the provider has the new password, but the account stays as it is.
        log.error("identity.password_change_not_recorded", { staff_id: staffId });
        return refuse("not_required", "conflict");
      }
      if (account.role === "admin") await deps.completeBootstrapIfReady(staffId);
      const enrolled = await idp.hasVerifiedAuthenticator(account.authUserId);
      return ok({ gate: setupGate({ mustChangePassword: false, role: account.role, authenticatorEnrolled: enrolled }) });
    },

    /**
     * An Admin re-issues a starting password that expired or was used without being replaced: the
     * provider's password is set to the starting password again, the account is active again and a
     * new 24-hour window starts. Audited as `password.reissued`. Not for someone who already chose
     * their own password (that is S01.08's "Reset password").
     */
    async reissueStartingPassword(actorId: string, usernameInput: string): Promise<Result<{ username: string; startingPassword: string }, ReissueError>> {
      const actor = await store.findById(db, actorId);
      const refuse = async (code: ReissueError, reason: AuditReason, subjectId: string | null) => {
        await audit.recordRefusal(db, { action: "password.reissued", actorStaffId: actor ? actor.id : null, subjectType: "staff_account", subjectId, meta: { reason } });
        return err(code);
      };
      if (!actor || !mayManageAccounts(actor)) return refuse("forbidden", "forbidden", null);
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

      const set = await idp.setPassword(target.authUserId, starting.value);
      if (!set.ok) return refuse("provider_error", "provider_error", target.id);
      const reissued = await db.transaction(async (tx) => {
        const current = await store.findById(tx, actor.id);
        if (!current || !mayManageAccounts(current)) return false;
        if (!(await store.reissueStartingPassword(tx, target.id, deps.now()))) return false;
        await audit.record(tx, { action: "password.reissued", actorStaffId: actor.id, subjectType: "staff_account", subjectId: target.id });
        return true;
      });
      if (!reissued) return refuse("not_reissuable", "conflict", target.id);
      return ok({ username: target.username, startingPassword: starting.value });
    },

    /** The end of the failed-sign-in lock on this username, if one is in force (an input of isUsableAdmin). */
    signInLockedUntil: signInLockReader(deps),

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

export type StaffAuthService = ReturnType<typeof createStaffAuthService>;
