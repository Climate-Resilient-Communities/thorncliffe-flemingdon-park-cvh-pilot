import { cache } from "react";
import type { StaffSession } from "@/modules/identity";
import { identityConfigured, requestAuthSessions, staffAuth } from "./identity";

export type { StaffSession };

/**
 * The server-side session lookup of every staff page, route handler and server action, always
 * through the guard (./guard.ts). Supabase Auth verifies the session in the request's cookies, the
 * staff_account of its user is loaded, and the request has a session only when that account's
 * status is `active` (AD-4); the result carries the setup gate the person is at, the session limits
 * of S01.08 are applied, and S01.10's authenticator level (`aal`) comes from the verified token and
 * the app's own record that this session reached it.
 *
 * Fail closed: where sign-in is not configured (no Supabase settings, as in the smoke checks)
 * nobody is signed in; a provider or database failure throws, so the request fails rather than
 * passing. Looked up once per page render (the layout's banner and the page share it).
 */
export const currentStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (!identityConfigured()) return null;
  return staffAuth().currentSession(await requestAuthSessions());
});
