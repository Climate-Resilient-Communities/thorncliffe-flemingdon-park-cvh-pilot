import type { FactorEnrolment } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import { staffError, staffJson, staffRoute } from "@/app/staff/guard";
import { requestAuthSessions, staffAuth } from "@/app/staff/identity";

export const dynamic = "force-dynamic";

/**
 * `POST /api/staff/factor/enrol` (gate 2, S01.10): starts setting up an authenticator for an Admin
 * or Coordinator who has none. The answer is the new secret and its QR code, shown once and never
 * stored by the app (no-store, like every staff answer); asking again replaces it with a new one.
 */
export const POST = staffRoute({ route: "/api/staff/factor/enrol", access: "enrol_authenticator" }, async (_request, session) => {
  const result = await staffAuth().startEnrolment(session, await requestAuthSessions());
  if (result.ok) {
    const enrolment: FactorEnrolment = { secret: result.value.secret, uri: result.value.uri, qrCode: result.value.qrCode };
    return staffJson(enrolment);
  }
  if (result.error === "not_required") return staffError(409, "bad_request", englishText("staff.authenticator.errors.notRequired"));
  return staffError(503, "unavailable", englishText("staff.authenticator.errors.unavailable"));
});
