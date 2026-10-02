import type { StaffRole } from "../../../contracts/staffRoles";
import type { Db, DbTransaction } from "../../../platform/db";
import { SYSTEM_ACTOR, type AuditAction, type AuditEvent, type REFUSAL_REASONS } from "../../audit";
import { actorCan } from "../domain/accountAuthority";
import { bootstrapCompletes, bootstrapPhase, decideUnderBootstrap, type BootstrapPhase, type StaffIntent } from "../domain/bootstrap";
import { loginForUsername, validateNewAccount, type NewAccount, type NewAccountInput } from "../domain/newAccount";
import type { IdentityRefusal } from "../domain/refusals";
import { err, ok, type Result } from "../domain/result";
import { PEPPER_NOT_CONFIGURED_EVENT, type PasswordPepper } from "./passwordPepper";
import type { IdentityProvider, OperationalLog, StaffStore } from "./ports";
import { isAccountUsableAdmin, type SignInLockReader } from "./usability";

export type AuditReason = (typeof REFUSAL_REASONS)[number];

/** The audit module's two writers (its index.ts), injected so tests can watch them. */
export interface AuditWriter {
  record<A extends AuditAction>(tx: DbTransaction, event: AuditEvent<A>): Promise<void>;
  recordRefusal<A extends AuditAction>(db: Db, event: AuditEvent<A>): Promise<void>;
}

export interface AccountDeps {
  db: Db;
  store: StaffStore;
  idp: IdentityProvider;
  audit: AuditWriter;
  log: OperationalLog;
  now: () => Date;
  newId: () => string;
  /** What the provider stores for a password (passwordPepper.ts); null when STAFF_PASSWORD_PEPPER is not configured. */
  pepper: PasswordPepper | null;
  /** The failed-sign-in lock of a username (S01.07), an input of isUsableAdmin. */
  signInLockedUntil: SignInLockReader;
}

export interface CreatedAccount {
  staffId: string;
  username: string;
  /** Shown once to whoever created the account, who hands it over in person; never sent. */
  startingPassword: string;
  role: StaffRole;
}

/** What "Add a person" offers this actor, for the screen. */
export type AddPersonView =
  | { allowed: true; roles: StaffRole[]; bootstrap: BootstrapPhase }
  | { allowed: false; refusal: "forbidden" | "bootstrap_incomplete" };

/** The audit reason of each refusal (S01.04's REFUSAL_REASONS). */
export const AUDIT_REASONS: Record<IdentityRefusal, AuditReason> = {
  username_invalid: "validation",
  first_name_missing: "validation",
  last_name_missing: "validation",
  name_too_long: "validation",
  starting_password_empty: "validation",
  starting_password_unsupported_letter: "validation",
  starting_password_too_long: "validation",
  email_invalid: "validation",
  role_invalid: "validation",
  username_taken: "duplicate",
  admin_exists: "conflict",
  bootstrap_incomplete: "bootstrap_incomplete",
  two_admin_rule: "two_admin_rule",
  self_action: "self_action",
  account_removed: "conflict",
  no_change: "conflict",
  not_found: "not_found",
  forbidden: "forbidden",
  unauthenticated: "unauthenticated",
  provider_error: "provider_error",
  provider_rejected: "provider_error",
  passwords_not_configured: "provider_error",
};

/** An unlinked login must be at least this old before it counts as left behind (see removeOrphanedLogin). */
const ORPHAN_MIN_AGE_MS = 5 * 60 * 1000;

const ALL_ROLES: StaffRole[] = ["ambassador", "coordinator", "director", "admin"];

/** A refusal found inside the transaction, returned through it (nothing was written). */
class Refusal {
  constructor(readonly code: IdentityRefusal) {}
}

export function createAccountService(deps: AccountDeps) {
  const { db, store, idp, audit, log } = deps;

  async function refuseCreation(actorStaffId: string | null, code: IdentityRefusal, role?: StaffRole) {
    await audit.recordRefusal(db, {
      action: "account.created",
      actorStaffId,
      subjectType: "staff_account",
      subjectId: null,
      meta: { reason: AUDIT_REASONS[code], ...(role ? { role } : {}) },
    });
    return err(code);
  }

  async function refusePermission(actorStaffId: string | null, code: "forbidden" | "bootstrap_incomplete" | "unauthenticated", permission: string) {
    await audit.recordRefusal(db, {
      action: "permission.denied",
      actorStaffId,
      subjectType: "staff_account",
      subjectId: actorStaffId,
      meta: { status: code === "unauthenticated" ? 401 : 403, permission, reason: AUDIT_REASONS[code] },
    });
    return err(code);
  }

  /** Undoes a login whose account was refused or failed. A failure leaves a login with no account, which can do nothing. */
  async function deleteLogin(authUserId: string) {
    try {
      await idp.deleteLogin(authUserId);
    } catch (error) {
      log.error("identity.login_not_deleted", {
        auth_user_id: authUserId,
        error: error instanceof Error ? error.constructor.name : "unknown",
      });
    }
  }

  /**
   * A login this app created earlier whose account was never saved (the delete after a refusal
   * failed, or the process stopped between the two steps) blocks its username for ever. It is
   * removed when no staff_account is linked to it and it carries the app's staff marker; a login
   * younger than ORPHAN_MIN_AGE_MS may belong to a request still writing its account, so it stays.
   */
  async function removeOrphanedLogin(login: string): Promise<boolean> {
    try {
      const found = await idp.findLogin(login);
      if (!found || !found.staffMarker) return false;
      if (deps.now().getTime() - found.createdAt.getTime() < ORPHAN_MIN_AGE_MS) return false;
      if (await store.authUserLinked(db, found.authUserId)) return false;
      await idp.deleteLogin(found.authUserId);
      log.error("identity.orphaned_login_removed", { auth_user_id: found.authUserId });
      return true;
    } catch (error) {
      log.error("identity.orphaned_login_not_removed", { error: error instanceof Error ? error.constructor.name : "unknown" });
      return false;
    }
  }

  async function createLogin(account: NewAccount): Promise<Result<string, IdentityRefusal>> {
    if (!deps.pepper) {
      log.error(PEPPER_NOT_CONFIGURED_EVENT, { operation: "create_account" });
      return err("passwords_not_configured");
    }
    // The provider stores the peppered starting password, never the one handed over.
    const input = { login: loginForUsername(account.username), password: deps.pepper(account.startingPassword) };
    let created = await idp.createLogin(input);
    if (!created.ok && created.error === "login_taken" && (await removeOrphanedLogin(input.login))) {
      created = await idp.createLogin(input);
    }
    if (created.ok) return ok(created.authUserId);
    if (created.error === "login_taken") return err("username_taken");
    return err(created.error === "rejected" ? "provider_rejected" : "provider_error");
  }

  /**
   * Creates the login, then runs `write` in a transaction under the accounts lock. If `write`
   * refuses (throws a Refusal) or anything fails, the login is deleted again.
   */
  async function createWithLogin(
    actorStaffId: string | null,
    account: NewAccount,
    write: (tx: DbTransaction, authUserId: string) => Promise<string>,
  ): Promise<Result<CreatedAccount, IdentityRefusal>> {
    const login = await createLogin(account);
    if (!login.ok) return refuseCreation(actorStaffId, login.error, account.role);
    let staffId: string;
    try {
      staffId = await db.transaction(async (tx) => {
        await store.lockAccounts(tx);
        return write(tx, login.value);
      });
    } catch (error) {
      await deleteLogin(login.value);
      if (error instanceof Refusal) return refuseCreation(actorStaffId, error.code, account.role);
      throw error;
    }
    return ok({ staffId, username: account.username, startingPassword: account.startingPassword, role: account.role });
  }

  return {
    /**
     * The first Admin (scripts/create-first-admin): only while no Admin exists and bootstrap has
     * never started. Starts bootstrap and audits `account.created` with the system as actor. Two
     * concurrent runs create one Admin: the second finds the first's under the accounts lock.
     */
    async createFirstAdmin(input: Omit<NewAccountInput, "role">): Promise<Result<CreatedAccount, IdentityRefusal>> {
      const valid = validateNewAccount({ ...input, role: "admin" });
      if (!valid.ok) return refuseCreation(SYSTEM_ACTOR, valid.error, "admin");
      const account = valid.value;
      const adminExists = async (executor: Db | DbTransaction) =>
        (await store.adminExists(executor)) || (await store.readBootstrap(executor)) !== null;
      if (await adminExists(db)) return refuseCreation(SYSTEM_ACTOR, "admin_exists", "admin");
      if (await store.usernameTaken(db, account.username)) return refuseCreation(SYSTEM_ACTOR, "username_taken", "admin");

      return createWithLogin(SYSTEM_ACTOR, account, async (tx, authUserId) => {
        if (await adminExists(tx)) throw new Refusal("admin_exists");
        if (await store.usernameTaken(tx, account.username)) throw new Refusal("username_taken");
        const id = deps.newId();
        await store.insertAccount(tx, { ...account, id, authUserId, startingPasswordIssuedAt: deps.now(), createdBy: null });
        await store.startBootstrap(tx, id);
        await audit.record(tx, {
          action: "account.created",
          actorStaffId: SYSTEM_ACTOR,
          subjectType: "staff_account",
          subjectId: id,
          meta: { role: "admin", bootstrap: true },
        });
        return id;
      });
    },

    /** What "Add a person" offers this actor: refused for anyone but an active Admin, and limited during bootstrap. */
    async addPersonView(actorId: string): Promise<AddPersonView> {
      const actor = await store.findById(db, actorId);
      if (!actor || !actorCan(actor, "accounts.manage")) return { allowed: false, refusal: "forbidden" };
      const state = await store.readBootstrap(db);
      const roles = ALL_ROLES.filter((role) => decideUnderBootstrap(state, actor.id, { kind: "create_account", role }).ok);
      if (roles.length === 0) return { allowed: false, refusal: "bootstrap_incomplete" };
      return { allowed: true, roles, bootstrap: bootstrapPhase(state) };
    },

    /**
     * "Add a person": an Admin creates an account with a starting password and
     * `must_change_password`; nothing is sent to anyone. During bootstrap only the first Admin may
     * create, and only the one second Admin.
     */
    async addPerson(actorId: string, input: NewAccountInput): Promise<Result<CreatedAccount, IdentityRefusal>> {
      const actor = await store.findById(db, actorId);
      if (!actor || !actorCan(actor, "accounts.manage")) return refusePermission(actor ? actor.id : null, "forbidden", "accounts.create");
      const valid = validateNewAccount(input);
      if (!valid.ok) return refuseCreation(actor.id, valid.error);
      const account = valid.value;
      const intent: StaffIntent = { kind: "create_account", role: account.role };
      const decision = decideUnderBootstrap(await store.readBootstrap(db), actor.id, intent);
      if (!decision.ok) return refuseCreation(actor.id, decision.error, account.role);
      if (await store.usernameTaken(db, account.username)) return refuseCreation(actor.id, "username_taken", account.role);

      return createWithLogin(actor.id, account, async (tx, authUserId) => {
        // Read again under the lock: the actor may have lost the role, or a concurrent request
        // may have created the second Admin or taken the username.
        const current = await store.findById(tx, actor.id);
        if (!current || !actorCan(current, "accounts.manage")) throw new Refusal("forbidden");
        const decided = decideUnderBootstrap(await store.readBootstrap(tx), actor.id, intent);
        if (!decided.ok) throw new Refusal(decided.error);
        if (await store.usernameTaken(tx, account.username)) throw new Refusal("username_taken");
        const id = deps.newId();
        await store.insertAccount(tx, { ...account, id, authUserId, startingPasswordIssuedAt: deps.now(), createdBy: actor.id });
        const secondAdmin = decided.value === "creates_second_admin";
        if (secondAdmin) await store.setSecondAdmin(tx, id);
        await audit.record(tx, {
          action: "account.created",
          actorStaffId: actor.id,
          subjectType: "staff_account",
          subjectId: id,
          meta: secondAdmin ? { role: account.role, bootstrap: true } : { role: account.role },
        });
        return id;
      });
    },

    /**
     * Audits a staff action called without a session (401) as `permission.denied`, with the system
     * as actor. `route` is the route pattern, never a value from the request.
     */
    async refuseUnauthenticated(permission: string, route: string): Promise<void> {
      // One audit record per call, as the spec requires. Anyone can call the action without a
      // session, so this volume is unbounded until rate limiting arrives (the future rate-limit story).
      await audit.recordRefusal(db, {
        action: "permission.denied",
        actorStaffId: SYSTEM_ACTOR,
        subjectType: "staff_account",
        subjectId: null,
        meta: { status: 401, permission, route, reason: "unauthenticated" },
      });
    },

    /**
     * The bootstrap gate for any staff action other than account creation: refuses with
     * `bootstrap_incomplete` ("Finish setting up two Admins first") and audits `permission.denied`.
     * S01.07 and S01.10 pass `complete_own_setup` for the setup gates; S01.12 calls it beside `can()`.
     */
    async checkBootstrap(actorId: string, intent: StaffIntent, permission: string): Promise<Result<void, "bootstrap_incomplete">> {
      const decision = decideUnderBootstrap(await store.readBootstrap(db), actorId, intent);
      if (decision.ok) return ok(undefined);
      await refusePermission(actorId, "bootstrap_incomplete", permission);
      return err("bootstrap_incomplete");
    },

    /**
     * Ends bootstrap when both pending Admins are usable, and audits `bootstrap.completed` once.
     * S01.07 calls it after a password is replaced and S01.10 after an authenticator is enrolled,
     * with the account that just finished the step as actor. Returns true when this call ended it.
     */
    async completeBootstrapIfReady(actorId: string): Promise<boolean> {
      const state = await store.readBootstrap(db);
      if (state === null || bootstrapPhase(state) !== "in_progress" || state.secondAdminId === null) return false;
      const now = deps.now();
      const usable = async (id: string) => {
        const account = await store.findById(db, id);
        return account !== null && isAccountUsableAdmin(deps, db, account, now);
      };
      const ready = bootstrapCompletes(state, { firstAdmin: await usable(state.firstAdminId), secondAdmin: await usable(state.secondAdminId) });
      if (!ready) return false;
      return db.transaction(async (tx) => {
        await store.lockAccounts(tx);
        if (bootstrapPhase(await store.readBootstrap(tx)) !== "in_progress") return false;
        await store.completeBootstrap(tx);
        await audit.record(tx, { action: "bootstrap.completed", actorStaffId: actorId, subjectType: "staff_bootstrap", subjectId: null });
        return true;
      });
    },
  };
}

export type AccountService = ReturnType<typeof createAccountService>;
