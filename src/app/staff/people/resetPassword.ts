import { englishText } from "@/i18n/text";
import { REFUSAL_MESSAGE_KEYS, type PasswordResetService, type ResetPasswordError } from "@/modules/identity";
import type { StaffSession } from "../session";

/** What the reset form shows after a submission. Every text is already resolved from the catalog. */
export type ResetPasswordState =
  | { status: "idle" }
  | { status: "refused"; message: string; username: string }
  | { status: "reset"; done: string; line: string };

export interface ResetPasswordDeps {
  identity: () => Pick<PasswordResetService, "resetPassword">;
}

const MESSAGE_KEYS: Record<ResetPasswordError, string> = {
  forbidden: "staff.resetPassword.errors.forbidden",
  bootstrap_incomplete: REFUSAL_MESSAGE_KEYS.bootstrap_incomplete,
  not_found: "staff.resetPassword.errors.notFound",
  self_action: "staff.resetPassword.errors.selfAction",
  not_resettable: "staff.resetPassword.errors.notResettable",
  provider_error: "staff.resetPassword.errors.providerError",
  passwords_not_configured: "staff.resetPassword.errors.passwordsNotConfigured",
};

export const resetUsername = (form: FormData) => {
  const value = form.get("username");
  return typeof value === "string" ? value : "";
};

/**
 * "Reset password" (S01.08): an Admin gives someone who forgot their password a new starting
 * password; every session of theirs ends. The identity module decides and audits; the new
 * starting password is shown once, to hand over in person.
 */
export async function resetPasswordFromForm(deps: ResetPasswordDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ResetPasswordState> {
  const username = resetUsername(form);
  const result = await deps.identity().resetPassword(session.staffId, username);
  if (!result.ok) return { status: "refused", message: englishText(MESSAGE_KEYS[result.error]), username };
  return {
    status: "reset",
    done: englishText("staff.resetPassword.done", { username: result.value.username, password: result.value.startingPassword }),
    line: englishText("staff.resetPassword.doneLine"),
  };
}
