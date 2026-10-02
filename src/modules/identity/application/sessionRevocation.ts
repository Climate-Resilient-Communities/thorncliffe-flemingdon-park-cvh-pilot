import type { DbTransaction } from "../../../platform/db";
import type { RevocationCause } from "../domain/sessionLimits";
import type { AuditWriter } from "./accounts";
import type { StaffSessionStore, StaffStore } from "./ports";

export interface SessionRevocationDeps {
  store: Pick<StaffStore, "bumpSessionGeneration">;
  sessions: Pick<StaffSessionStore, "revokeAll">;
  audit: AuditWriter;
  now: () => Date;
}

/**
 * Session revocation (S01.08), internal to the identity module: suspension, removal, a role change,
 * an Admin's password reset (passwordReset.ts) and an authenticator reset (S01.11) end every
 * session of the account on every device. `revokeAll` runs inside the caller's transaction, after
 * it changed the account: every open staff_session row of the account is revoked, the account's
 * revocation count goes up (a sign-in that checked a password before this cannot keep its session)
 * and `session.revoked` is audited with the cause and how many sessions ended.
 *
 * This is the guarantee: every staff request checks its staff_session row (S01.07's
 * currentSession), so the next request of any of those sessions is refused even while Supabase
 * still accepts its token. At the provider, Supabase's admin password update is the only global
 * sign-out it offers: the password reset and the re-issue use it; the other causes rely on this.
 */
export function createSessionRevocation(deps: SessionRevocationDeps) {
  return {
    async revokeAll(tx: DbTransaction, target: { staffId: string; actorStaffId: string | null; cause: RevocationCause }): Promise<number> {
      await deps.store.bumpSessionGeneration(tx, target.staffId);
      const revoked = await deps.sessions.revokeAll(tx, target.staffId, deps.now());
      await deps.audit.record(tx, {
        action: "session.revoked",
        actorStaffId: target.actorStaffId,
        subjectType: "staff_account",
        subjectId: target.staffId,
        meta: { cause: target.cause, sessions: revoked },
      });
      return revoked;
    },
  };
}

export type SessionRevocation = ReturnType<typeof createSessionRevocation>;
