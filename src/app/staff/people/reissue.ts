import { englishText } from "@/i18n/text";
import { REFUSAL_MESSAGE_KEYS, type ReissueError, type StaffAuthService } from "@/modules/identity";
import type { StaffSession } from "../session";

/** What the re-issue form shows after a submission. Every text is already resolved from the catalog. */
export type ReissueState =
  | { status: "idle" }
  | { status: "refused"; message: string; username: string }
  | { status: "reissued"; done: string; line: string };

export interface ReissueDeps {
  staffAuth: () => Pick<StaffAuthService, "reissueStartingPassword">;
}

const MESSAGE_KEYS: Record<ReissueError, string> = {
  forbidden: "staff.reissue.errors.forbidden",
  bootstrap_incomplete: REFUSAL_MESSAGE_KEYS.bootstrap_incomplete,
  not_found: "staff.reissue.errors.notFound",
  not_reissuable: "staff.reissue.errors.notReissuable",
  provider_error: "staff.reissue.errors.providerError",
};

export const reissueUsername = (form: FormData) => {
  const value = form.get("username");
  return typeof value === "string" ? value : "";
};

/**
 * "Re-issue a starting password" (S01.07): an Admin restarts the 24-hour window of a starting
 * password that expired or was used without being replaced. The identity module decides and
 * audits; the new starting password is shown once, to hand over in person.
 */
export async function reissueFromForm(deps: ReissueDeps, session: Pick<StaffSession, "staffId">, form: FormData): Promise<ReissueState> {
  const username = reissueUsername(form);
  const result = await deps.staffAuth().reissueStartingPassword(session.staffId, username);
  if (!result.ok) return { status: "refused", message: englishText(MESSAGE_KEYS[result.error]), username };
  return {
    status: "reissued",
    done: englishText("staff.reissue.done", { username: result.value.username, password: result.value.startingPassword }),
    line: englishText("staff.reissue.doneLine"),
  };
}
