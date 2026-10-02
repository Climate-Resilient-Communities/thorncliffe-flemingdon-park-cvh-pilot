import { combineChunks, createServerClient, stringFromBase64URL } from "@supabase/ssr";
import { createClient, isAuthApiError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import type { AuthSessions, CookieJar, SessionCookieOptions } from "../application/ports";
import { DEFAULT_PROVIDER_TIMEOUT_MS, withTimeout } from "./supabaseIdentityProvider";

export interface SupabaseSessionConfig {
  /** The project URL (NEXT_PUBLIC_SUPABASE_URL). */
  url: string;
  /** The project's publishable key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY): sessions are the user's own, never the secret key's. */
  publishableKey: string;
  /** Secure cookies (https only): true everywhere but local development over http. */
  secureCookies: boolean;
  /** Test seam: the fetch the client uses. Tests pass a fake; nothing in a test reaches a real project. */
  fetch?: typeof fetch;
  /** How long any call to Supabase Auth may take before it is abandoned (default 5 s, like the Admin API's). */
  timeoutMs?: number;
}

/** The session cookie's name (chunked by @supabase/ssr as `<name>.0`, `<name>.1`… when long). */
export const SESSION_COOKIE = "sb-cvh-staff-auth-token";

/** Session cookies: sent only to this site, never readable by page scripts, and gone after 12 hours at most (AD-4). */
export function sessionCookieOptions(secure: boolean): SessionCookieOptions {
  return { path: "/", sameSite: "lax", httpOnly: true, secure, maxAge: 12 * 60 * 60 };
}

const BASE64_PREFIX = "base64-";
// Answers that mean "this token is not a valid session" rather than "the provider failed".
const NO_SESSION_STATUSES = new Set([400, 401, 403, 404]);

/**
 * AuthSessions on Supabase Auth: the session lives in the request's cookies in @supabase/ssr's
 * format (httpOnly, written only when a sign-in is accepted). Server-only; one instance per request.
 *
 * The session is never refreshed here: a page render cannot write cookies, and a refresh whose new
 * tokens are not stored makes Supabase revoke the session as a reused refresh token. The access
 * token therefore lasts the whole session (Supabase's JWT expiry, set to the 12-hour staff session
 * limit), each request checks it with Supabase Auth (`getUser`, which also fails once the session is
 * signed out or revoked), and S01.08 decides refreshes and idle limits.
 */
export function supabaseAuthSessions(config: SupabaseSessionConfig, jar: CookieJar): AuthSessions {
  const cookieOptions = sessionCookieOptions(config.secureCookies);
  const boundedFetch = withTimeout(config.fetch ?? fetch, config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS);

  // A client that never stores or refreshes a session: it only sends the token it is given.
  const plain = (): SupabaseClient =>
    createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: boundedFetch },
    });

  /** The access token of the request's session cookie, or null when there is none or it cannot be read. */
  async function accessToken(): Promise<string | null> {
    const cookies = new Map(jar.getAll().map(({ name, value }) => [name, value]));
    const raw = await combineChunks(SESSION_COOKIE, (name) => cookies.get(name));
    if (!raw) return null;
    try {
      const json = raw.startsWith(BASE64_PREFIX) ? stringFromBase64URL(raw.slice(BASE64_PREFIX.length)) : raw;
      const token = (JSON.parse(json) as { access_token?: unknown }).access_token;
      return typeof token === "string" && token !== "" ? token : null;
    } catch {
      return null;
    }
  }

  function clearCookies() {
    const stale = jar.getAll().filter(({ name }) => name === SESSION_COOKIE || name.startsWith(`${SESSION_COOKIE}.`));
    if (stale.length > 0) jar.setAll(stale.map(({ name }) => ({ name, value: "", options: { ...cookieOptions, maxAge: 0 } })));
  }

  return {
    async checkPassword({ login, password }) {
      // The new session's cookies are held back until the app accepts the sign-in.
      const held: Parameters<CookieJar["setAll"]>[0] = [];
      const holding = createServerClient(config.url, config.publishableKey, {
        cookies: { getAll: () => jar.getAll(), setAll: (cookies) => void held.push(...(cookies as typeof held)) },
        cookieOptions: { ...cookieOptions, name: SESSION_COOKIE },
        global: { fetch: boundedFetch },
      });
      let result;
      try {
        result = await holding.auth.signInWithPassword({ email: login, password });
      } catch {
        return { ok: false, error: "unavailable" };
      }
      const { data, error } = result;
      if (error) {
        const invalid = error.code === "invalid_credentials" || (isAuthApiError(error) && error.status === 400);
        return { ok: false, error: invalid ? "invalid_credentials" : "unavailable" };
      }
      if (!data.user || !data.session) return { ok: false, error: "unavailable" };
      const opened = data.session.access_token;
      return {
        ok: true,
        authUserId: data.user.id,
        async accept() {
          clearCookies();
          // @supabase/ssr always writes its own 400-day lifetime; the staff session cookie lasts 12 hours at most.
          jar.setAll(held.map((cookie) => (cookie.value === "" ? cookie : { ...cookie, options: { ...cookie.options, maxAge: cookieOptions.maxAge } })));
        },
        async discard() {
          held.length = 0;
          // Ends the session just opened at the provider; it was never written to a cookie.
          await plain().auth.admin.signOut(opened, "local").catch(() => undefined);
        },
      };
    },

    async currentUser() {
      const token = await accessToken();
      if (!token) return null;
      const { data, error } = await plain().auth.getUser(token);
      if (error) {
        // A signed-out or revoked session comes back from supabase-js as a missing session.
        if (isAuthSessionMissingError(error) || (isAuthApiError(error) && NO_SESSION_STATUSES.has(error.status))) return null;
        throw new Error(`Supabase Auth could not check the session (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
      }
      const factors = data.user.factors ?? [];
      return {
        authUserId: data.user.id,
        authenticatorEnrolled: factors.some((factor) => factor.factor_type === "totp" && factor.status === "verified"),
      };
    },

    async signOut() {
      const token = await accessToken();
      if (token) await plain().auth.admin.signOut(token, "local").catch(() => undefined);
      clearCookies();
    },
  };
}
