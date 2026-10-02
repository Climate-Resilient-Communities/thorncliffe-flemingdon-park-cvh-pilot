import { createClient } from "@supabase/supabase-js";
import type { IdentityProvider } from "../application/ports";

export interface SupabaseAdminConfig {
  /** The project URL (NEXT_PUBLIC_SUPABASE_URL). */
  url: string;
  /** The project's secret key (SUPABASE_SECRET_KEY): server only, never in a NEXT_PUBLIC_ variable. */
  secretKey: string;
  /** Test seam: the fetch the client uses. Tests pass a fake; nothing in a test reaches a real project. */
  fetch?: typeof fetch;
  /** How long any call to Supabase Auth may take before it is abandoned and reported as a provider error (default 5 s). */
  timeoutMs?: number;
}

/** The longest any call to Supabase Auth may take (S01.06: Admin rows can be locked while it runs). */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 5000;

/** A fetch that gives up after `ms`: the request is aborted, so the caller sees a failed call, never a hang. */
export function withTimeout(base: typeof fetch, ms: number): typeof fetch {
  return (input, init) => {
    const deadline = AbortSignal.timeout(ms);
    const signal = init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    return base(input, { ...init, signal });
  };
}

const TAKEN = new Set(["email_exists", "user_already_exists", "identity_already_exists", "conflict"]);
const REJECTED = new Set(["weak_password", "validation_failed", "email_address_invalid", "email_address_not_authorized", "bad_json"]);

/**
 * Supabase Auth is only ever given the peppered form of a password (application/passwordPepper.ts):
 * 64 lower-case hex characters, whatever the person typed. The Supabase project's minimum password
 * length (Auth > Providers > Email) must therefore stay at 64 or less, and its password-strength
 * rules must not require upper-case letters or symbols. A project that asks for more rejects them
 * (weak_password) and createLogin reports "rejected", which is not retryable: the Admin is told to
 * check the project's password policy. The domain still refuses passwords over 72 bytes.
 *
 * IdentityProvider on Supabase Auth's Admin API, with the secret key. Server-only: it is built
 * in the composition root (src/app, scripts/) from the validated environment and never reaches a
 * browser bundle. It creates confirmed users (`email_confirm: true`), so Supabase sends no
 * confirmation or invitation email; the login address is on a domain that cannot receive mail.
 */
export function supabaseIdentityProvider(config: SupabaseAdminConfig): IdentityProvider {
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: withTimeout(config.fetch ?? fetch, config.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS) },
  });
  const admin = client.auth.admin;

  return {
    async createLogin({ login, password }) {
      try {
        const { data, error } = await admin.createUser({
          email: login,
          password,
          email_confirm: true,
          app_metadata: { cvh_staff: true },
        });
        if (error) {
          const code = error.code ?? "";
          if (TAKEN.has(code) || /already (been )?registered|already exists/i.test(error.message)) return { ok: false, error: "login_taken" };
          if (REJECTED.has(code) || error.status === 422 || error.status === 400) return { ok: false, error: "rejected" };
          return { ok: false, error: "unavailable" };
        }
        if (!data.user) return { ok: false, error: "unavailable" };
        return { ok: true, authUserId: data.user.id };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async findLogin(login) {
      // The Admin API has no lookup by email: page through the users (a staff list is small).
      const perPage = 200;
      for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await admin.listUsers({ page, perPage });
        if (error) throw new Error(`Supabase Auth refused to list users (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
        const user = data.users.find((candidate) => candidate.email?.toLowerCase() === login.toLowerCase());
        if (user) return { authUserId: user.id, createdAt: new Date(user.created_at), staffMarker: user.app_metadata?.cvh_staff === true };
        if (data.users.length < perPage) return null;
      }
      return null;
    },

    async deleteLogin(authUserId) {
      const { error } = await admin.deleteUser(authUserId);
      if (error) throw new Error(`Supabase Auth refused to delete a user (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
    },

    async hasVerifiedAuthenticator(authUserId) {
      const { data, error } = await admin.mfa.listFactors({ userId: authUserId });
      if (error) throw new Error(`Supabase Auth refused to list factors (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
      return data.factors.some((factor) => factor.factor_type === "totp" && factor.status === "verified");
    },

    async removeFactors(authUserId) {
      const { data, error } = await admin.mfa.listFactors({ userId: authUserId });
      if (error) throw new Error(`Supabase Auth refused to list factors (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
      for (const factor of data.factors) {
        const removed = await admin.mfa.deleteFactor({ id: factor.id, userId: authUserId });
        if (removed.error) {
          throw new Error(`Supabase Auth refused to delete a factor (status ${removed.error.status ?? "unknown"}, code ${removed.error.code ?? "none"})`);
        }
      }
    },

    async setPassword(authUserId, password) {
      try {
        const { error } = await admin.updateUserById(authUserId, { password });
        if (!error) return { ok: true };
        if (REJECTED.has(error.code ?? "") || error.status === 422 || error.status === 400) return { ok: false, error: "rejected" };
        return { ok: false, error: "unavailable" };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
  };
}
