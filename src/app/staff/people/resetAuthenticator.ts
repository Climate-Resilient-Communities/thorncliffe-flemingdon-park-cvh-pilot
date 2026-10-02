import { englishText } from "@/i18n/text";
import { REFUSAL_MESSAGE_KEYS, type FactorRecoveryService, type ResetAuthenticatorError } from "@/modules/identity";
import type { StaffSession } from "../session";

/** What the "Reset authenticator" form shows after a submission. Every text is already resolved from the catalog. */
export type ResetAuthenticatorState =
  | { status: "idle" }
  | { status: "refused"; message: string; username: string }
  | { status: "reset"; done: string; line: string; notes: string[] };

export interface ResetAuthenticatorDeps {
  identity: () => Pick<FactorRecoveryService, "resetAuthenticator">;
}

const MESSAGE_KEYS: Record<ResetAuthenticatorError, string> = {
  forbidden: "staff.resetAuthenticator.errors.forbidden",
  bootstrap_incomplete: REFUSAL_MESSAGE_KEYS.bootstrap_incomplete,
  not_found: "staff.resetAuthenticator.errors.notFound",
  self_action: "staff.resetAuthenticator.errors.selfAction",
  not_resettable: "staff.resetAuthenticator.errors.notResettable",
  no_authenticator: "staff.resetAuthenticator.errors.noAuthenticator",
};

export const resetAuthenticatorUsername = (form: FormData) => {
  const value = form.get("username");
  return typeof value === "string" ? value : "";
};

/**
 * "Reset authenticator" (S01.11): an Admin removes the authenticator of a Coordinator or Admin who
 * lost their phone (never their own). The identity module decides and audits: the factor is removed,
 * every session of the person ends, and they enrol a new one at their next sign-in. When the reset
 * leaves fewer than two usable Admins it still happens (S01.06's recovery exception) and the result
 * says what to do next, as the banner does.
 */
export async function resetAuthenticatorFromForm(deps: ResetAuthenticatorDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ResetAuthenticatorState> {
  const username = resetAuthenticatorUsername(form);
  const result = await deps.identity().resetAuthenticator(session.staffId, username);
  if (!result.ok) return { status: "refused", message: englishText(MESSAGE_KEYS[result.error]), username };
  const notes: string[] = [];
  if (result.value.adminShortfall) notes.push(englishText("staff.resetAuthenticator.shortfall"));
  if (!result.value.providerCleared) notes.push(englishText("staff.resetAuthenticator.providerNote"));
  return {
    status: "reset",
    done: englishText("staff.resetAuthenticator.done", { username: result.value.username }),
    line: englishText("staff.resetAuthenticator.doneLine"),
    notes,
  };
}
