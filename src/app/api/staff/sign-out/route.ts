import { SIGN_IN_PAGE } from "@/contracts/staffAuth";
import { publicStaffRoute, staffJson } from "@/app/staff/guard";
import { identityConfigured, requestAuthSessions, staffAuth } from "@/app/staff/identity";

export const dynamic = "force-dynamic";

/**
 * `POST /api/staff/sign-out`: ends the request's session at the provider and clears its cookie.
 * Reachable at every setup gate, and also without a valid session (it then only clears cookies),
 * so signing out never fails.
 */
export const POST = publicStaffRoute("/api/staff/sign-out", async () => {
  if (identityConfigured()) await staffAuth().signOut(await requestAuthSessions());
  return staffJson({ next: SIGN_IN_PAGE });
});
