import { FactorCodeRequest, GATE_PAGES, type StaffApiError } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import type { AuthenticatorCodeError } from "@/modules/identity";
import { clientAddress } from "@/app/staff/clientAddress";
import { readJson, staffError, staffJson, staffRoute } from "@/app/staff/guard";
import { requestAuthSessions, staffAuth } from "@/app/staff/identity";

export const dynamic = "force-dynamic";

/** Each refusal's status, wire code and catalog message. */
const REFUSALS: Record<AuthenticatorCodeError, { status: number; error: StaffApiError; key: string }> = {
  code_invalid: { status: 400, error: "code_invalid", key: "staff.authenticator.errors.codeInvalid" },
  code_locked: { status: 429, error: "code_locked", key: "staff.authenticator.errors.locked" },
  not_required: { status: 409, error: "bad_request", key: "staff.authenticator.errors.notRequired" },
  provider_error: { status: 503, error: "unavailable", key: "staff.authenticator.errors.unavailable" },
};

/**
 * `POST /api/staff/factor/verify` (S01.10): an authenticator code, at gate 2 (the code that
 * confirms a new authenticator) or at the code gate after the password (the code of this sign-in).
 * When it is right the session is `aal2` for the rest of its 12 hours, and the answer names the Hub.
 */
export const POST = staffRoute({ route: "/api/staff/factor/verify", access: ["enrol_authenticator", "authenticator_code"], action: "account.own_setup" }, async (request, session) => {
  const body = await readJson(request, FactorCodeRequest);
  if (!body.ok) return body.response;
  const result = await staffAuth().verifyAuthenticatorCode(session, { code: body.value.code, client: clientAddress(request.headers) }, await requestAuthSessions());
  if (result.ok) return staffJson({ next: GATE_PAGES[result.value.gate] });
  const refusal = REFUSALS[result.error];
  return staffError(refusal.status, refusal.error, englishText(refusal.key));
});
