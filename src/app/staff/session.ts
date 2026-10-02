/** The signed-in staff member of a request, as the staff pages and actions need it. */
export interface StaffSession {
  staffId: string;
}

/**
 * The server-side session lookup of every staff page and action.
 *
 * Stub until S01.07 (sign-in), which replaces this function's body: it will read the Supabase
 * session from the request's cookies, verify it with Supabase Auth, load the staff_account by its
 * auth user and return it only when its status is active (AD-4); S01.07, S01.08 and S01.10 add the
 * setup gates, session limits and authenticator level there.
 *
 * Until then nobody is signed in, in every environment: every staff page sends the visitor to
 * sign-in and every staff action is refused as unauthenticated (fail closed). There is no
 * development or test bypass, so nothing behind it can be reached without a real session.
 */
export async function currentStaffSession(): Promise<StaffSession | null> {
  return null;
}
