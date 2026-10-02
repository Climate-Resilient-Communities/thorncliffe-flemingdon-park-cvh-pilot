// The identity module's public interface (AD-2, AD-4): staff accounts, the one-time bootstrap of
// the first two Admins and, in later stories, sign-in, sessions, authenticators and the role policy.
import { createHmac, randomBytes } from "node:crypto";
import type { Db } from "../../platform/db";
import { uuidv7 } from "../../platform/ids";
import * as audit from "../audit";
import { stdoutOperationalLog } from "./adapters/operationalLog";
import { drizzleStaffSessionStore } from "./adapters/sessionStore";
import { drizzleStaffStore } from "./adapters/staffStore";
import { drizzleThrottleStore } from "./adapters/throttleStore";
import { createAccountService, type AccountService, type AuditWriter } from "./application/accounts";
import type { IdentityProvider } from "./application/ports";
import { createAdminRecovery } from "./application/adminRecovery";
import { createFactorRecovery, type FactorRecoveryService } from "./application/factorRecovery";
import { createFactorReset } from "./application/factorReset";
import { passwordPepper } from "./application/passwordPepper";
import { createPasswordResetService, type PasswordResetService } from "./application/passwordReset";
import { createSessionRevocation } from "./application/sessionRevocation";
import { createStaffAuthService, signInLockReader, type StaffAuthService } from "./application/staffAuth";
import { createStaffChangeService, type StaffChangeService } from "./application/staffChanges";

// Used only where no key is given (scripts and tests, which never read a lock written by the app):
// random per process, so no key ever sits in the repository.
const PROCESS_THROTTLE_KEY = randomBytes(32).toString("hex");

export interface IdentityWiring {
  db: Db;
  /** Supabase Auth in the app and the CLI (supabaseIdentityProvider); an in-memory fake in tests. */
  idp: IdentityProvider;
  /**
   * The server-only key of the failed-sign-in throttle's hashes (src/app/staff/identity.ts derives
   * it). Scripts and tests that never read the app's locks may leave it out.
   */
  throttleKey?: string;
  /**
   * STAFF_PASSWORD_PEPPER (src/platform/config/env.ts): the provider stores passwords peppered with
   * it. Without it every operation that gives the provider a password refuses (fail closed).
   */
  passwordPepper?: string;
  /** Test seams. */
  now?: () => Date;
  newId?: () => string;
  audit?: AuditWriter;
  /** How long a change waits for a row lock before failing; default 5 s. */
  lockTimeoutMs?: number;
  /** Test seams of the sign-in's timing pad (staffAuth.ts, MIN_REFUSAL_MS). */
  sleep?: (ms: number) => Promise<void>;
  monotonicMs?: () => number;
  minRefusalMs?: number;
}

/**
 * The throttle's hash key derived from a server-only secret (the Supabase secret key): an HMAC with
 * a fixed label, so no new secret is needed and the key never leaves the server. Rotating the
 * secret only forgets current sign-in failures and locks.
 */
export function throttleKeyFromSecret(secret: string): string {
  return createHmac("sha256", secret).update("cvh:sign-in-throttle:v1").digest("hex");
}

/** The failed-sign-in lock of a username, read with the wiring's throttle key. */
function lockReader(wiring: IdentityWiring) {
  const read = signInLockReader({ throttle: drizzleThrottleStore, throttleKey: wiring.throttleKey ?? PROCESS_THROTTLE_KEY, now: wiring.now ?? (() => new Date()) });
  return (username: string) => read(wiring.db, username);
}

/**
 * The identity module's use cases: accounts and bootstrap (S01.05), changes under the two-Admin rule
 * (S01.06), each ending the account's sessions, an Admin's password reset (S01.08) and the
 * authenticator reset (S01.11).
 */
export type IdentityService = AccountService & StaffChangeService & PasswordResetService & FactorRecoveryService;

/** The identity use cases, wired to the identity tables, the audit trail and the given identity provider. */
export function createIdentity(wiring: IdentityWiring): IdentityService {
  const deps = {
    db: wiring.db,
    idp: wiring.idp,
    store: drizzleStaffStore,
    audit: wiring.audit ?? audit,
    log: stdoutOperationalLog,
    now: wiring.now ?? (() => new Date()),
    newId: wiring.newId ?? (() => uuidv7()),
    signInLockedUntil: lockReader(wiring),
    lockTimeoutMs: wiring.lockTimeoutMs,
    pepper: passwordPepper(wiring.passwordPepper),
  };
  // Session revocation and the recovery exception stay inside the module (S01.08, S01.06).
  const revocation = createSessionRevocation({ store: drizzleStaffStore, sessions: drizzleStaffSessionStore, audit: deps.audit, now: deps.now });
  const { beginAdminRecovery } = createAdminRecovery(deps);
  const factorReset = createFactorReset({ ...deps, beginAdminRecovery, revocation });
  return {
    ...createAccountService(deps),
    ...createStaffChangeService({ ...deps, revocation }),
    ...createPasswordResetService({ ...deps, revocation, beginAdminRecovery }),
    ...createFactorRecovery({ ...deps, factorReset }),
  };
}

/**
 * Sign-in, the session lookup, the setup gates' password change, the authenticator enrolment and
 * code check (S01.10) and the re-issue of starting passwords (S01.07), wired like createIdentity.
 * `accounts` is the IdentityService whose bootstrap completion runs after a password change or an
 * Admin's enrolment (created from the same wiring when not given); the automatic locks go through
 * the module's internal recovery exception (S01.06).
 */
export function createStaffAuth(wiring: IdentityWiring & { throttleKey: string; accounts?: IdentityService }): StaffAuthService {
  const accounts = wiring.accounts ?? createIdentity(wiring);
  return createStaffAuthService({
    db: wiring.db,
    idp: wiring.idp,
    store: drizzleStaffStore,
    throttle: drizzleThrottleStore,
    sessionStore: drizzleStaffSessionStore,
    pepper: passwordPepper(wiring.passwordPepper),
    sleep: wiring.sleep,
    monotonicMs: wiring.monotonicMs,
    minRefusalMs: wiring.minRefusalMs,
    lockTimeoutMs: wiring.lockTimeoutMs,
    audit: wiring.audit ?? audit,
    log: stdoutOperationalLog,
    now: wiring.now ?? (() => new Date()),
    throttleKey: wiring.throttleKey,
    completeBootstrapIfReady: (actorId) => accounts.completeBootstrapIfReady(actorId),
    beginAdminRecovery: createAdminRecovery({
      store: drizzleStaffStore,
      idp: wiring.idp,
      now: wiring.now ?? (() => new Date()),
      lockTimeoutMs: wiring.lockTimeoutMs,
      signInLockedUntil: lockReader(wiring),
    }).beginAdminRecovery,
  });
}

export { MEMORY_SESSION_COOKIE, memoryIdentityProvider, type MemoryIdentityProvider } from "./adapters/memoryIdentityProvider";
export { sessionCookieOptions, supabaseAuthSessions, type SupabaseSessionConfig } from "./adapters/supabaseAuthSessions";
export { supabaseIdentityProvider, type SupabaseAdminConfig } from "./adapters/supabaseIdentityProvider";
export type { AccountService, AddPersonView, CreatedAccount } from "./application/accounts";
export { PEPPER_NOT_CONFIGURED_MESSAGE, pepperPassword } from "./application/passwordPepper";
export type {
  AuthSessions,
  AuthSessionsFactory,
  CookieJar,
  CreateLoginError,
  EnrolFactorError,
  FactorEnrolment,
  FactorVerification,
  IdentityProvider,
  SessionCookieOptions,
  SessionUser,
  StaffSessionRecord,
  StaffSessionStore,
} from "./application/ports";
export { AUTHENTICATOR_ISSUER, MIN_REFUSAL_MS, REQUIRED_TOKEN_LIFETIME_SECONDS } from "./application/staffAuth";
export type {
  AuthenticatorCodeError,
  ChangePasswordError,
  CurrentSession,
  FirstAdminReissueError,
  ReissueError,
  SignInOutcome,
  StaffAuthService,
  StaffSession,
  StartEnrolmentError,
} from "./application/staffAuth";
export { type StaffChangeService } from "./application/staffChanges";
export type { PasswordResetService, ResetPasswordError } from "./application/passwordReset";
export type { AuthenticatorResetDone, FactorRecoveryService, FactorResetReason, RecoverAdminError, ResetAuthenticatorError } from "./application/factorRecovery";
export { AMBASSADOR_IDLE_MS, SESSION_ABSOLUTE_MS, sessionLimits } from "./domain/sessionLimits";
export { OWN_PASSWORD_MAX_BYTES, OWN_PASSWORD_MIN_LENGTH, type OwnPasswordError } from "./domain/ownPassword";
export { AUTHENTICATOR_ROLES, needsAuthenticator, setupGate } from "./domain/setupGate";
export { PRIVILEGED_ACTIONS, REQUIRED_ASSURANCE, isPrivilegedAction, meetsAssurance, type PrivilegedAction } from "./domain/assurance";
export { AUTHENTICATOR_CODE_DIGITS, normaliseAuthenticatorCode } from "./domain/authenticatorCode";
export { CLIENT_LIMIT, USERNAME_LIMIT } from "./domain/signInThrottle";
export { STARTING_PASSWORD_VALID_MS } from "./domain/startingPasswordWindow";
export { mayManageAccounts, type Actor } from "./domain/accountAuthority";
export { MIN_USABLE_ADMINS } from "./domain/adminFloor";
export { bootstrapPhase, type BootstrapPhase, type BootstrapState, type StaffIntent } from "./domain/bootstrap";
export { STAFF_LOGIN_DOMAIN, loginForUsername, type NewAccountInput } from "./domain/newAccount";
export { REFUSAL_FIELDS, REFUSAL_MESSAGE_KEYS, type IdentityRefusal } from "./domain/refusals";
export { STAFF_STATUSES, type StaffStatus } from "./domain/staffAccount";
export { deriveStartingPassword } from "./domain/startingPassword";
export { isUsableAdmin, type AdminUsabilityFacts } from "./domain/usableAdmin";
