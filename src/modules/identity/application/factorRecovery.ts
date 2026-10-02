import type { Db } from "../../../platform/db";
import { SYSTEM_ACTOR, type FACTOR_RESET_REASONS } from "../../audit";
import { mayManageAccounts } from "../domain/accountAuthority";
import { decideUnderBootstrap } from "../domain/bootstrap";
import { isUsernameFormat, normaliseUsername } from "../domain/newAccount";
import { err, ok, type Result } from "../domain/result";
import { needsAuthenticator } from "../domain/setupGate";
import type { StaffAccount } from "../domain/staffAccount";
import type { AuditReason, AuditWriter } from "./accounts";
import type { FactorReset, FactorResetCheck } from "./factorReset";
import type { IdentityProvider, StaffSessionStore, StaffStore } from "./ports";
import { SESSION_ABSOLUTE_MS } from "../domain/sessionLimits";
import { adminStandings, type SignInLockReader } from "./usability";

export type ResetAuthenticatorError =
  | "forbidden"
  | "bootstrap_incomplete"
  | "not_found"
  /** The Admin named their own account: another Admin does it. */
  | "self_action"
  /** Suspended or removed. */
  | "not_resettable"
  /** Ambassadors and Directors have no authenticator. */
  | "no_authenticator";

export type RecoverAdminError =
  | "not_found"
  /** IT named an account that is not an Admin: an Admin resets those. */
  | "not_admin"
  | "not_resettable"
  /** Another usable Admin exists, so one of them resets it from the Hub. */
  | "other_usable_admin"
  /** With the attestation: another Admin has a live aal2 session, so they can reset it from the Hub. */
  | "other_admin_signed_in";

export interface AuthenticatorResetDone {
  username: string;
  /** The reset left fewer than two usable Admins (recovery exception, S01.06). */
  adminShortfall: boolean;
  /**
   * False when the provider could not delete the old factor after the app forgot it: nothing is
   * lost (the old factor counts nowhere, and the next enrolment removes it first).
   */
  providerCleared: boolean;
}

export type FactorResetReason = (typeof FACTOR_RESET_REASONS)[number];

export interface FactorRecoveryDeps {
  db: Db;
  idp: IdentityProvider;
  /**
   * The failed-sign-in lock of a username (S01.07), read through the given executor: inside the
   * reset's transaction it is the transaction, never a second pool connection.
   */
  signInLockedUntil: SignInLockReader;
  /** Open aal2 sessions (S01.10), read through the reset's transaction. */
  sessions: Pick<StaffSessionStore, "withLiveAal2">;
  store: StaffStore;
  audit: AuditWriter;
  now: () => Date;
  /** S01.10's hook (factorReset.ts): the recovery exception, the clearing, the revocation and the audit record. */
  factorReset: Pick<FactorReset, "resetFactor">;
}

const RESETTABLE = new Set<StaffAccount["status"]>(["active", "locked_pending_reissue"]);

/**
 * "Reset authenticator" (S01.11), the two ways in. Both build on S01.10's factorReset, which does
 * the work in one transaction under S01.06's recovery exception (the factor forgotten, every
 * session revoked with cause `factor_reset`, `factor.reset` audited with `admin_shortfall` when it
 * leaves fewer than two usable Admins, then the provider's factors deleted); this adds who may ask:
 *
 *  - `resetAuthenticator`: an Admin, for a Coordinator or Admin, never themselves. Bootstrap rules
 *    as for a password reset. An Admin target is allowed even when it leaves fewer than two usable
 *    Admins (the recovery exception); bootstrap never returns.
 *  - `recoverAdmin`: IT's scripts/recover-admin, actor `system`, for one Admin, and only when no
 *    other usable Admin exists (otherwise one of them resets it from the Hub). The count is taken
 *    under the Admin rows' locks, so two runs, or a run and a sign-in, cannot both pass it.
 *
 * What the caller is allowed is checked again inside the transaction, after the locks.
 */
export function createFactorRecovery(deps: FactorRecoveryDeps) {
  const { db, store, audit } = deps;

  const refuse = (actorStaffId: string | null, subjectId: string | null, reason: AuditReason) =>
    audit.recordRefusal(db, { action: "factor.reset", actorStaffId, subjectType: "staff_account", subjectId, meta: { reason } });

  return {
    async resetAuthenticator(actorId: string, usernameInput: string): Promise<Result<AuthenticatorResetDone, ResetAuthenticatorError>> {
      const actor = await store.findById(db, actorId);
      const refused = async (code: ResetAuthenticatorError, reason: AuditReason, subjectId: string | null) => {
        await refuse(actor ? actor.id : null, subjectId, reason);
        return err(code);
      };
      if (!actor || !mayManageAccounts(actor)) return refused("forbidden", "forbidden", null);
      const username = normaliseUsername(usernameInput);
      const target = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;
      if (!target) return refused("not_found", "not_found", null);
      if (target.id === actor.id) return refused("self_action", "self_action", target.id);
      if (!decideUnderBootstrap(await store.readBootstrap(db), actor.id, { kind: "other" }).ok) return refused("bootstrap_incomplete", "bootstrap_incomplete", target.id);
      if (!RESETTABLE.has(target.status)) return refused("not_resettable", "conflict", target.id);
      if (!needsAuthenticator(target.role)) return refused("no_authenticator", "validation", target.id);

      const check: FactorResetCheck = async (tx, locked) => {
        const current = await store.findById(tx, actor.id);
        if (!current || !mayManageAccounts(current)) return "forbidden";
        if (!RESETTABLE.has(locked.status)) return "not_resettable";
        return needsAuthenticator(locked.role) ? null : "no_authenticator";
      };
      const result = await deps.factorReset.resetFactor({ staffId: target.id, actorStaffId: actor.id, cause: "lost_device" }, check);
      if (result.ok) return ok({ username: target.username, ...result.value });
      switch (result.error) {
        case "forbidden":
          return refused("forbidden", "forbidden", target.id);
        case "no_authenticator":
          return refused("no_authenticator", "validation", target.id);
        case "not_found":
          return refused("not_found", "not_found", target.id);
        default:
          return refused("not_resettable", "conflict", target.id);
      }
    },

    async recoverAdmin(
      usernameInput: string,
      reason: FactorResetReason,
      options: { attested?: boolean } = {},
    ): Promise<Result<AuthenticatorResetDone, RecoverAdminError>> {
      const refused = async (code: RecoverAdminError, auditReason: AuditReason, subjectId: string | null) => {
        await refuse(SYSTEM_ACTOR, subjectId, auditReason);
        return err(code);
      };
      const username = normaliseUsername(usernameInput);
      const target = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;
      if (!target) return refused("not_found", "not_found", null);
      if (target.role !== "admin") return refused("not_admin", "forbidden", target.id);
      if (!RESETTABLE.has(target.status)) return refused("not_resettable", "conflict", target.id);

      const check: FactorResetCheck = async (tx, locked) => {
        if (locked.role !== "admin") return "forbidden";
        if (!RESETTABLE.has(locked.status)) return "not_resettable";
        // The Admin rows are locked (the recovery exception took them): this count cannot change under us.
        const others = (await store.listAdmins(tx)).filter((admin) => admin.id !== locked.id);
        if (options.attested) {
          // The operator attests that no Admin can sign in; an Admin with a live aal2 session can, so that still refuses.
          const since = new Date(deps.now().getTime() - SESSION_ABSOLUTE_MS);
          const signedIn = await deps.sessions.withLiveAal2(tx, others.map((admin) => admin.id), since);
          return signedIn.length > 0 ? "other_admin_signed_in" : null;
        }
        // Every read inside the transaction goes through the transaction's own connection.
        const standings = await adminStandings(deps, tx, others, deps.now());
        return standings.some((admin) => admin.usable) ? "other_usable_admin" : null;
      };
      const result = await deps.factorReset.resetFactor(
        { staffId: target.id, actorStaffId: SYSTEM_ACTOR, cause: reason, ...(options.attested ? { attested: true as const } : {}) },
        check,
      );
      if (result.ok) return ok({ username: target.username, ...result.value });
      switch (result.error) {
        case "other_usable_admin":
          return refused("other_usable_admin", "conflict", target.id);
        case "other_admin_signed_in":
          return refused("other_admin_signed_in", "conflict", target.id);
        case "forbidden":
          return refused("not_admin", "forbidden", target.id);
        case "not_found":
          return refused("not_found", "not_found", target.id);
        default:
          return refused("not_resettable", "conflict", target.id);
      }
    },
  };
}

export type FactorRecoveryService = ReturnType<typeof createFactorRecovery>;
