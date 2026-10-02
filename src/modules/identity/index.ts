// The identity module's public interface (AD-2, AD-4): staff accounts, the one-time bootstrap of
// the first two Admins and, in later stories, sign-in, sessions, authenticators and the role policy.
import { randomBytes } from "node:crypto";
import type { Db } from "../../platform/db";
import { uuidv7 } from "../../platform/ids";
import * as audit from "../audit";
import { stdoutOperationalLog } from "./adapters/operationalLog";
import { drizzleStaffStore } from "./adapters/staffStore";
import { drizzleThrottleStore } from "./adapters/throttleStore";
import { createAccountService, type AccountService, type AuditWriter } from "./application/accounts";
import type { IdentityProvider } from "./application/ports";
import { createStaffAuthService, signInLockReader, type StaffAuthService } from "./application/staffAuth";

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
  /** Test seams. */
  now?: () => Date;
  newId?: () => string;
  audit?: AuditWriter;
}

/** The account use cases, wired to the identity tables, the audit trail and the given identity provider. */
export function createIdentity(wiring: IdentityWiring): AccountService {
  return createAccountService({
    db: wiring.db,
    idp: wiring.idp,
    store: drizzleStaffStore,
    audit: wiring.audit ?? audit,
    log: stdoutOperationalLog,
    now: wiring.now ?? (() => new Date()),
    newId: wiring.newId ?? (() => uuidv7()),
    signInLockedUntil: signInLockReader({
      throttle: drizzleThrottleStore,
      throttleKey: wiring.throttleKey ?? PROCESS_THROTTLE_KEY,
      now: wiring.now ?? (() => new Date()),
    }),
  });
}

/**
 * Sign-in, the session lookup, the setup gates' password change and the re-issue of starting
 * passwords (S01.07), wired like createIdentity. `accounts` is the AccountService whose bootstrap
 * completion runs after a password change (created from the same wiring when not given).
 */
export function createStaffAuth(wiring: IdentityWiring & { throttleKey: string; accounts?: AccountService }): StaffAuthService {
  const accounts = wiring.accounts ?? createIdentity(wiring);
  return createStaffAuthService({
    db: wiring.db,
    idp: wiring.idp,
    store: drizzleStaffStore,
    throttle: drizzleThrottleStore,
    audit: wiring.audit ?? audit,
    log: stdoutOperationalLog,
    now: wiring.now ?? (() => new Date()),
    throttleKey: wiring.throttleKey,
    completeBootstrapIfReady: (actorId) => accounts.completeBootstrapIfReady(actorId),
  });
}

export { MEMORY_SESSION_COOKIE, memoryIdentityProvider, type MemoryIdentityProvider } from "./adapters/memoryIdentityProvider";
export { sessionCookieOptions, supabaseAuthSessions, type SupabaseSessionConfig } from "./adapters/supabaseAuthSessions";
export { supabaseIdentityProvider, type SupabaseAdminConfig } from "./adapters/supabaseIdentityProvider";
export type { AccountService, AddPersonView, CreatedAccount } from "./application/accounts";
export type { AuthSessions, AuthSessionsFactory, CookieJar, CreateLoginError, IdentityProvider, SessionCookieOptions } from "./application/ports";
export type { ChangePasswordError, ReissueError, SignInOutcome, StaffAuthService, StaffSession } from "./application/staffAuth";
export { OWN_PASSWORD_MAX_BYTES, OWN_PASSWORD_MIN_LENGTH, type OwnPasswordError } from "./domain/ownPassword";
export { setupGate } from "./domain/setupGate";
export { CLIENT_LIMIT, USERNAME_LIMIT } from "./domain/signInThrottle";
export { STARTING_PASSWORD_VALID_MS } from "./domain/startingPasswordWindow";
export { mayManageAccounts, type Actor } from "./domain/accountAuthority";
export { bootstrapPhase, type BootstrapPhase, type BootstrapState, type StaffIntent } from "./domain/bootstrap";
export { STAFF_LOGIN_DOMAIN, loginForUsername, type NewAccountInput } from "./domain/newAccount";
export { REFUSAL_FIELDS, REFUSAL_MESSAGE_KEYS, type IdentityRefusal } from "./domain/refusals";
export { STAFF_STATUSES, type StaffStatus } from "./domain/staffAccount";
export { deriveStartingPassword } from "./domain/startingPassword";
export { isUsableAdmin, type AdminUsabilityFacts } from "./domain/usableAdmin";
