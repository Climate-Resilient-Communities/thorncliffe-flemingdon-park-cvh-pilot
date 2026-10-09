import type { Db, DbTransaction } from "../../../platform/db";
import { actorCan } from "../domain/accountAuthority";
import { decideUnderBootstrap } from "../domain/bootstrap";
import { isUsernameFormat, normaliseUsername } from "../domain/newAccount";
import { err, ok, type Result } from "../domain/result";
import { deriveStartingPassword } from "../domain/startingPassword";
import type { AuditReason, AuditWriter } from "./accounts";
import { DEFAULT_LOCK_TIMEOUT_MS, adminShortfallMeta, type AdminRecovery } from "./adminRecovery";
import { PEPPER_NOT_CONFIGURED_EVENT, type PasswordPepper } from "./passwordPepper";
import type { IdentityProvider, OperationalLog, StaffStore } from "./ports";
import type { SessionRevocation } from "./sessionRevocation";

export type ResetPasswordError =
  | "forbidden"
  | "bootstrap_incomplete"
  | "not_found"
  /** The Admin named their own account: there is no self-service reset; another Admin does it. */
  | "self_action"
  /** Suspended or removed, or a name that gives no starting password. */
  | "not_resettable"
  /** The provider did not take the new starting password: the account stays locked until a reset or re-issue succeeds. */
  | "provider_error"
  /** STAFF_PASSWORD_PEPPER is not configured (S01.07): nothing changed. */
  | "passwords_not_configured";

export interface PasswordResetDeps {
  db: Db;
  store: StaffStore;
  idp: IdentityProvider;
  audit: AuditWriter;
  log: OperationalLog;
  now: () => Date;
  /** What the provider stores for a password (S01.07's pepper); null when not configured (the reset refuses). */
  pepper: PasswordPepper | null;
  /** S01.06's recovery exception, called first in the reset's transaction (internal to the module). */
  beginAdminRecovery: (tx: DbTransaction, targetId: string) => Promise<AdminRecovery>;
  revocation: Pick<SessionRevocation, "revokeAll">;
  /** How long a transaction waits for the account's row lock (default DEFAULT_LOCK_TIMEOUT_MS). */
  lockTimeoutMs?: number;
}

/** A refusal found inside the transaction (nothing was written). */
class ResetRefusal {
  constructor(readonly code: ResetPasswordError) {}
}

/**
 * An Admin's "Reset password" (S01.08) for someone who forgot theirs; there is no self-service
 * reset in the pilot. A new starting password is issued with S01.07's rules (valid once, for 24
 * hours), every session of the account ends, and `password.reset` is audited. For an Admin it is a
 * recovery action (S01.06): allowed even when it leaves fewer than two usable Admins, then audited
 * with `admin_shortfall: true`.
 *
 * Steps, so that no moment lets the old password or a half-done reset in:
 *  1. one transaction, under the recovery exception's locks: the account is held at
 *     `locked_pending_reissue` with `must_change_password` (sign-in refuses it), its sessions are
 *     revoked (`session.revoked`) and `password.reset` is audited;
 *  2. the provider's password becomes the (peppered) starting password, which also ends every
 *     session the account has at the provider (Supabase's only global sign-out);
 *  3. a second transaction makes the account active with a new 72-hour window and counts one more
 *     revocation, so a sign-in that checked the old password before step 2 cannot keep its session.
 * If step 2 or 3 fails the account stays locked, and another reset or a re-issue (S01.07) finishes
 * it.
 */
export function createPasswordResetService(deps: PasswordResetDeps) {
  const { db, store, idp, audit, log } = deps;

  return {
    async resetPassword(actorId: string, usernameInput: string): Promise<Result<{ username: string; startingPassword: string }, ResetPasswordError>> {
      const actor = await store.findById(db, actorId);
      const refuse = async (code: ResetPasswordError, reason: AuditReason, subjectId: string | null) => {
        await audit.recordRefusal(db, { action: "password.reset", actorStaffId: actor ? actor.id : null, subjectType: "staff_account", subjectId, meta: { reason } });
        return err(code);
      };
      if (!actor || !actorCan(actor, "accounts.manage")) return refuse("forbidden", "forbidden", null);
      const username = normaliseUsername(usernameInput);
      const target = isUsernameFormat(username) ? await store.findByUsername(db, username) : null;
      if (!target) return refuse("not_found", "not_found", null);
      if (target.id === actor.id) return refuse("self_action", "self_action", target.id);
      const gate = decideUnderBootstrap(await store.readBootstrap(db), actor.id, { kind: "other" });
      if (!gate.ok) return refuse("bootstrap_incomplete", "bootstrap_incomplete", target.id);
      if (target.status !== "active" && target.status !== "locked_pending_reissue") return refuse("not_resettable", "conflict", target.id);
      const starting = deriveStartingPassword(target.firstName, target.lastName);
      if (!starting.ok) return refuse("not_resettable", "validation", target.id);
      if (!deps.pepper) {
        log.error(PEPPER_NOT_CONFIGURED_EVENT, { operation: "reset_password" });
        return refuse("passwords_not_configured", "provider_error", target.id);
      }
      const providerPassword = deps.pepper(starting.value);

      try {
        await db.transaction(async (tx) => {
          // Serialised with "choose your password" and a re-issue (staffAuth.ts): the lock timeout,
          // then the account row's lock (the recovery exception takes it too, with the Admin rows
          // first when the target is an Admin), and only then the account is changed.
          await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
          const recovery = await deps.beginAdminRecovery(tx, target.id);
          if (!(await store.lockAccount(tx, target.id))) throw new ResetRefusal("not_found");
          const current = await store.findById(tx, actor.id);
          if (!current || !actorCan(current, "accounts.manage")) throw new ResetRefusal("forbidden");
          if (!(await store.beginPasswordReset(tx, target.id, deps.now()))) throw new ResetRefusal("not_resettable");
          await audit.record(tx, {
            action: "password.reset",
            actorStaffId: actor.id,
            subjectType: "staff_account",
            subjectId: target.id,
            meta: adminShortfallMeta(recovery),
          });
          await deps.revocation.revokeAll(tx, { staffId: target.id, actorStaffId: actor.id, cause: "password_reset" });
        });
      } catch (error) {
        if (error instanceof ResetRefusal) return refuse(error.code, error.code === "forbidden" ? "forbidden" : "conflict", target.id);
        throw error;
      }

      // Supabase's admin password update also ends every session the account has at the provider:
      // the provider's global sign-out.
      const set = await idp.setPassword(target.authUserId, providerPassword);
      let finished = false;
      if (set.ok) {
        finished = await db.transaction(async (tx) => {
          // Only this account's row: it is not usable before or after (a starting password is in
          // use), so the two-Admin rule has nothing to count.
          await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
          if (!(await store.reissueStartingPassword(tx, target.id, deps.now()))) return false;
          await store.bumpSessionGeneration(tx, target.id);
          return true;
        });
      }
      if (!finished) {
        log.error("identity.password_reset_unfinished", { staff_id: target.id, provider: set.ok ? "ok" : set.error });
        // The account stays locked_pending_reissue: the reset was audited, the sessions are revoked.
        return refuse("provider_error", "provider_error", target.id);
      }
      return ok({ username: target.username, startingPassword: starting.value });
    },
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
