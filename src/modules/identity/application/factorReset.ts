import type { Db, DbTransaction } from "../../../platform/db";
import { err, ok, type Result } from "../domain/result";
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

/** Why the authenticator was lost: an Admin's reset (S01.11) or IT's script when every Admin lost access. */
export type FactorResetCause = "lost_device" | "all_admins_lost_access";

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
 * factor no longer counts anywhere, and the next enrolment removes it before making a new one.
 */
export function createFactorReset(deps: FactorResetDeps) {
  const { db, store, audit } = deps;
  return {
    async resetFactor(target: { staffId: string; actorStaffId: string | null; cause: FactorResetCause }): Promise<Result<{ adminShortfall: boolean }, "not_found" | "provider_error">> {
      const done = await db.transaction(async (tx) => {
        const recovery = await deps.beginAdminRecovery(tx, target.staffId);
        const account = await store.findById(tx, target.staffId);
        if (!account) return null;
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
      try {
        await deps.idp.removeFactors(done.account.authUserId);
      } catch (error) {
        deps.log.error("identity.factors_not_removed", { staff_id: done.account.id, error: error instanceof Error ? error.constructor.name : "unknown" });
        return err("provider_error");
      }
      return ok({ adminShortfall: done.recovery.adminShortfall });
    },
  };
}

export type FactorReset = ReturnType<typeof createFactorReset>;
