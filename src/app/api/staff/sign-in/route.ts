import { GATE_PAGES, SignInRequest } from "@/contracts/staffAuth";
import { englishText } from "@/i18n/text";
import { clientAddress } from "@/app/clientAddress";
import { publicStaffRoute, readJson, staffError, staffJson } from "@/app/staff/guard";
import { identityConfigured, requestAuthSessions, staffAuth } from "@/app/staff/identity";

export const dynamic = "force-dynamic";

/**
 * `POST /api/staff/sign-in` (S01.07): username and password. On success the session cookie is set
 * and the answer names the page of the person's setup gate. Every failure but an expired starting
 * password answers with the same message, whether or not the username exists.
 */
export const POST = publicStaffRoute("/api/staff/sign-in", async (request) => {
  const body = await readJson(request, SignInRequest);
  if (!body.ok) return body.response;
  if (!identityConfigured()) return staffError(503, "unavailable", englishText("staff.signIn.unavailable"));
  const outcome = await staffAuth().signIn(await requestAuthSessions(), { ...body.value, client: clientAddress(request.headers) });
  if (outcome.ok) return staffJson({ next: GATE_PAGES[outcome.gate] });
  switch (outcome.error) {
    case "starting_password_expired":
      return staffError(401, "starting_password_expired", englishText("staff.signIn.expired"));
    case "unavailable":
      return staffError(503, "unavailable", englishText("staff.signIn.unavailable"));
    default:
      return staffError(401, "sign_in_failed", englishText("staff.signIn.failed"));
  }
});
