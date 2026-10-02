import type { Db, DbTransaction } from "../../../platform/db";
import type { FACTOR_RESET_REASONS } from "../../audit";
import { err, ok, type Result } from "../domain/result";
import type { StaffAccount } from "../domain/staffAccount";
import type { AuditWriter } from "./accounts";
import { adminShortfallMeta, type AdminRecovery } from "./adminRecovery";
import type { IdentityProvider, OperationalLog, StaffStore } from "./ports";
import type { SessionRevocation } from "./sessionRevocation";

export interface FactorResetDeps {
  db: Db;
  store: StaffStore;
  idp: IdentityProvider;
  audit: AuditWriter;
  log: OperationalLog;
  /** S01.06's recovery exception, called first in the reset's transaction (internal to the module). */
  beginAdminRecovery: (tx: DbTransaction, targetId: string) => Promise<AdminRecovery>;
  revocation: Pick<SessionRevocation, "revokeAll">;
}

/** Why the authenticator was reset: a code from the audit module's fixed list (no free text). */
export type FactorResetCause = (typeof FACTOR_RESET_REASONS)[number];

/**
 * What the caller found out under the locks (S01.11): a refusal decided on the account as locked
 * (still allowed to be acted on, the actor still an Admin, no other usable Admin for IT's script),
 * or null to go ahead. Nothing has been written when it runs.
 */
export type FactorResetCheck = (tx: DbTransaction, account: StaffAccount) => Promise<FactorResetRefusal | null>;
export type FactorResetRefusal = "forbidden" | "not_resettable" | "no_authenticator" | "other_usable_admin";

/**
 * The authenticator reset (S01.10's hook for S01.11), internal to the identity module like session
 * revocation: S01.11 builds "Reset authenticator" (another Admin, never the person themselves) and
 * scripts/recover-admin on it, with their own authority checks.
 *
 * One transaction, under the recovery exception's locks (an Admin's reset is a recovery action,
 * allowed even when it leaves fewer than two usable Admins, then audited with `admin_shortfall`):
 * the account's factor_enrolled_at is cleared (its next sign-in stops at gate 2), every session
 * is revoked (`session.revoked`, cause `factor_reset`) and `factor.reset` is audited. Then every
 * factor is removed at the provider; if that fails the app's record is already gone, so the old
 * factor no longer counts anywhere, and the next enrolment removes it before making a new one
 * (the reset still succeeded: `providerCleared` is false and the failure is logged).
 */
export function createFactorReset(deps: FactorResetDeps) {
  const { db, store, audit } = deps;
  return {
    async resetFactor(
      target: { staffId: string; actorStaffId: string | null; cause: FactorResetCause },
      check?: FactorResetCheck,
    ): Promise<Result<{ adminShortfall: boolean; providerCleared: boolean }, "not_found" | FactorResetRefusal>> {
      const done = await db.transaction(async (tx) => {
        const recovery = await deps.beginAdminRecovery(tx, target.staffId);
        const account = await store.findById(tx, target.staffId);
        if (!account) return null;
        const refusal = check ? await check(tx, account) : null;
        if (refusal) return refusal;
        await store.clearFactorEnrolment(tx, account.id);
        await deps.revocation.revokeAll(tx, { staffId: account.id, actorStaffId: target.actorStaffId, cause: "factor_reset" });
        await audit.record(tx, {
          action: "factor.reset",
          actorStaffId: target.actorStaffId,
          subjectType: "staff_account",
          subjectId: account.id,
          meta: { recovery: target.cause, ...adminShortfallMeta(recovery) },
        });
        return { account, recovery };
      });
      if (!done) return err("not_found");
      if (typeof done === "string") return err(done);
      let providerCleared = true;
      try {
        await deps.idp.removeFactors(done.account.authUserId);
      } catch (error) {
        providerCleared = false;
        deps.log.error("identity.factors_not_removed", { staff_id: done.account.id, error: error instanceof Error ? error.constructor.name : "unknown" });
      }
      return ok({ adminShortfall: done.recovery.adminShortfall, providerCleared });
    },
  };
}

export type FactorReset = ReturnType<typeof createFactorReset>;
