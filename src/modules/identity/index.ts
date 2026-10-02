// The identity module's public interface (AD-2, AD-4): staff accounts, the one-time bootstrap of
// the first two Admins and, in later stories, sign-in, sessions, authenticators and the role policy.
import type { Db } from "../../platform/db";
import { uuidv7 } from "../../platform/ids";
import * as audit from "../audit";
import { stdoutOperationalLog } from "./adapters/operationalLog";
import { drizzleStaffStore } from "./adapters/staffStore";
import { createAccountService, type AccountService, type AuditWriter } from "./application/accounts";
import type { IdentityProvider } from "./application/ports";
import { createStaffChangeService, type StaffChangeService } from "./application/staffChanges";

export interface IdentityWiring {
  db: Db;
  /** Supabase Auth in the app and the CLI (supabaseIdentityProvider); an in-memory fake in tests. */
  idp: IdentityProvider;
  /** Test seams. */
  now?: () => Date;
  newId?: () => string;
  audit?: AuditWriter;
  /** How long a change waits for a row lock before failing; default 5 s. */
  lockTimeoutMs?: number;
}

/** The identity module's use cases: accounts and bootstrap (S01.05), and changes under the two-Admin rule (S01.06). */
export type IdentityService = AccountService & StaffChangeService;

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
    lockTimeoutMs: wiring.lockTimeoutMs,
  };
  return { ...createAccountService(deps), ...createStaffChangeService(deps) };
}

export { supabaseIdentityProvider, type SupabaseAdminConfig } from "./adapters/supabaseIdentityProvider";
export type { AccountService, AddPersonView, CreatedAccount } from "./application/accounts";
export type { CreateLoginError, IdentityProvider } from "./application/ports";
export { type StaffChangeService } from "./application/staffChanges";
export { mayManageAccounts, type Actor } from "./domain/accountAuthority";
export { MIN_USABLE_ADMINS } from "./domain/adminFloor";
export { bootstrapPhase, type BootstrapPhase, type BootstrapState, type StaffIntent } from "./domain/bootstrap";
export { STAFF_LOGIN_DOMAIN, loginForUsername, type NewAccountInput } from "./domain/newAccount";
export { REFUSAL_FIELDS, REFUSAL_MESSAGE_KEYS, type IdentityRefusal } from "./domain/refusals";
export { STAFF_STATUSES, type StaffStatus } from "./domain/staffAccount";
export { deriveStartingPassword } from "./domain/startingPassword";
export { isUsableAdmin, type AdminUsabilityFacts } from "./domain/usableAdmin";
