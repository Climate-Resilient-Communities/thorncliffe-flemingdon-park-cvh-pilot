import { GATE_PAGES, PasswordRequest } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import type { ChangePasswordError } from "@/modules/identity";
import { readJson, staffError, staffJson, staffRoute } from "@/app/staff/guard";
import { staffAuth } from "@/app/staff/identity";

export const dynamic = "force-dynamic";

/** Each refusal's status and catalog message. */
const REFUSALS: Record<ChangePasswordError, { status: number; key: string }> = {
  password_too_short: { status: 400, key: "staff.setup.password.errors.tooShort" },
  password_too_long: { status: 400, key: "staff.setup.password.errors.tooLong" },
  password_contains_username: { status: 400, key: "staff.setup.password.errors.containsUsername" },
  password_is_starting_password: { status: 400, key: "staff.setup.password.errors.isStartingPassword" },
  password_mismatch: { status: 400, key: "staff.setup.password.errors.mismatch" },
  password_rejected: { status: 400, key: "staff.setup.password.errors.rejected" },
  provider_error: { status: 503, key: "staff.setup.password.errors.unavailable" },
  not_required: { status: 409, key: "staff.setup.password.errors.notRequired" },
};

/**
 * `POST /api/staff/password` (gate 1, "Choose your password"): replaces the starting password with
 * the person's own. The answer names the next gate's page.
 */
export const POST = staffRoute({ route: "/api/staff/password", access: "choose_password" }, async (request, session) => {
  const body = await readJson(request, PasswordRequest);
  if (!body.ok) return body.response;
  const result = await staffAuth().changePassword(session.staffId, body.value);
  if (result.ok) return staffJson({ next: GATE_PAGES[result.value.gate] });
  const refusal = REFUSALS[result.error];
  const code = result.error === "provider_error" ? "unavailable" : result.error === "not_required" ? "bad_request" : result.error;
  return staffError(refusal.status, code, englishText(refusal.key));
});
