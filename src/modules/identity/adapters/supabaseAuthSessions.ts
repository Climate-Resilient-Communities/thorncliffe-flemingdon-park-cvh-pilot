import { createHash } from "node:crypto";
import { combineChunks, createServerClient, stringFromBase64URL } from "@supabase/ssr";
import { createClient, isAuthApiError, isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import type { AssuranceLevel } from "../../../contracts/staffAuth";
import type { AuthSessions, CookieJar, FactorVerification, SessionCookieOptions } from "../application/ports";
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

/**
 * The claims of an access token, decoded without checking its signature: only ever read from a
 * token Supabase Auth just issued (a sign-in's answer) or just verified (`getUser`). Null when the
 * token is not a JWT.
 */
export function accessTokenClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof claims === "object" && claims !== null && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The staff_session key of an access token (SessionUser in ports.ts): SHA-256 of its `session_id`
 * claim, which Supabase Auth keeps for the whole session, or of the token itself when it has none.
 */
export function sessionKeyOf(token: string): string {
  const sessionId = accessTokenClaims(token)?.session_id;
  const named = typeof sessionId === "string" && sessionId !== "" ? sessionId : `access-token:${token}`;
  return createHash("sha256").update(named).digest("hex");
}

/** The `aal` claim of an access token: `aal2` only when it says exactly that. */
export function assuranceOf(token: string): AssuranceLevel {
  return accessTokenClaims(token)?.aal === "aal2" ? "aal2" : "aal1";
}

/** `exp - iat` of an access token, in seconds; null when it does not carry both. */
export function tokenLifetimeOf(token: string): number | null {
  const claims = accessTokenClaims(token);
  const { exp, iat } = claims ?? {};
  return typeof exp === "number" && typeof iat === "number" ? exp - iat : null;
}
// Answers that mean "this token is not a valid session" rather than "the provider failed".
const NO_SESSION_STATUSES = new Set([400, 401, 403, 404]);

/** Supabase Auth's codes for a wrong or stale authenticator code (the person types again). */
const WRONG_CODE = new Set(["mfa_verification_failed", "mfa_verification_rejected", "mfa_challenge_expired"]);

/** The name the factor carries at Supabase (one per user: every other factor is removed before an enrolment). */
export const FACTOR_FRIENDLY_NAME = "CVH Hub";

/**
 * AuthSessions on Supabase Auth: the session lives in the request's cookies in @supabase/ssr's
 * format (httpOnly, written only when a sign-in is accepted). Server-only; one instance per request.
 *
 * The session is never refreshed here: a page render cannot write cookies, and a refresh whose new
 * tokens are not stored makes Supabase revoke the session as a reused refresh token. The access
 * token therefore lasts the whole session (Supabase's JWT expiry, set to the 12-hour staff session
 * limit), each request checks it with Supabase Auth (`getUser`, which also fails once the session is
 * signed out or revoked), and S01.08 decides refreshes and idle limits.
 *
 * Authenticators (S01.10): enrolment and a code check are the user's own calls with the session's
 * access token (`/factors`, `/factors/{id}/challenge`, `/factors/{id}/verify`). A right code raises
 * the session to `aal2`: Supabase issues new tokens for the same session (`session_id` unchanged),
 * written to the cookie only when the app accepts. The level is read from the verified token's
 * `aal` claim, never from anything else the browser sends.
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

  /**
   * A client on the request's session cookie whose cookie writes are held back in `held` (the
   * staff session cookie lasts 12 hours at most, so they are rewritten by writeHeld). It only sends
   * the cookie's access token, which the guard verified (`getUser`) earlier in this request.
   */
  function cookieClient(held: Parameters<CookieJar["setAll"]>[0]) {
    return createServerClient(config.url, config.publishableKey, {
      cookies: { getAll: () => jar.getAll(), setAll: (cookies) => void held.push(...(cookies as typeof held)) },
      cookieOptions: { ...cookieOptions, name: SESSION_COOKIE },
      global: { fetch: boundedFetch },
    });
  }

  /** Writes held cookies, with the staff session's own lifetime instead of @supabase/ssr's 400 days. */
  function writeHeld(held: Parameters<CookieJar["setAll"]>[0]) {
    clearCookies();
    jar.setAll(held.map((cookie) => (cookie.value === "" ? cookie : { ...cookie, options: { ...cookie.options, maxAge: cookieOptions.maxAge } })));
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
        sessionKey: sessionKeyOf(opened),
        tokenLifetimeSeconds: tokenLifetimeOf(opened),
        async accept() {
          // @supabase/ssr always writes its own 400-day lifetime; the staff session cookie lasts 12 hours at most.
          writeHeld(held);
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
        // Read only now that Supabase Auth has verified the token.
        sessionKey: sessionKeyOf(token),
        aal: assuranceOf(token),
      };
    },

    async enrolFactor({ issuer }) {
      const held: Parameters<CookieJar["setAll"]>[0] = [];
      try {
        const { data, error } = await cookieClient(held).auth.mfa.enroll({ factorType: "totp", friendlyName: FACTOR_FRIENDLY_NAME, issuer });
        if (error || !data) {
          const status = error && "status" in error ? (error.status as number | undefined) : undefined;
          return { ok: false, error: status !== undefined && status >= 400 && status < 500 && status !== 429 ? "rejected" : "unavailable" };
        }
        // Nothing about the session changes: the held cookies (if any) are not written.
        return { ok: true, enrolment: { secret: data.totp.secret, uri: data.totp.uri, qrCode: data.totp.qr_code || null } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async verifyFactor({ code, factor }): Promise<FactorVerification> {
      const held: Parameters<CookieJar["setAll"]>[0] = [];
      try {
        const client = cookieClient(held);
        // The user's factors, from Supabase Auth (getUser with the session's token).
        const listed = await client.auth.mfa.listFactors();
        if (listed.error) return { ok: false, error: "unavailable" };
        const candidates = listed.data.all
          .filter((candidate) => candidate.factor_type === "totp" && candidate.status === factor)
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const target = candidates.at(-1);
        if (!target) return { ok: false, error: "no_factor" };
        const { data, error } = await client.auth.mfa.challengeAndVerify({ factorId: target.id, code });
        if (error || !data) {
          const known = error && "code" in error ? (error.code as string | undefined) : undefined;
          return { ok: false, error: known !== undefined && WRONG_CODE.has(known) ? "invalid_code" : "unavailable" };
        }
        // The raised session's own token: read only from Supabase Auth's answer to the verification.
        const raised = data.access_token;
        return { ok: true, sessionKey: sessionKeyOf(raised), aal: assuranceOf(raised), accept: async () => writeHeld(held) };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async signOut() {
      const token = await accessToken();
      if (token) await plain().auth.admin.signOut(token, "local").catch(() => undefined);
      clearCookies();
    },
  };
}
