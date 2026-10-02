import type { StaffSession } from "@/modules/identity";
import { identityConfigured, requestAuthSessions, staffAuth } from "./identity";

export type { StaffSession };

/**
 * The server-side session lookup of every staff page, route handler and server action, always
 * through the guard (./guard.ts). Supabase Auth verifies the session in the request's cookies, the
 * staff_account of its user is loaded, and the request has a session only when that account's
 * status is `active` (AD-4); the result carries the setup gate the person is at. S01.08 adds the
 * session limits and S01.10 the authenticator level here.
 *
 * Fail closed: where sign-in is not configured (no Supabase settings, as in the smoke checks)
 * nobody is signed in; a provider or database failure throws, so the request fails rather than
 * passing.
 */
export async function currentStaffSession(): Promise<StaffSession | null> {
  if (!identityConfigured()) return null;
  return staffAuth().currentSession(await requestAuthSessions());
}
