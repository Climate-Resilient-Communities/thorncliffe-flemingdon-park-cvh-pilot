import { createClient } from "@supabase/supabase-js";
import type { IdentityProvider } from "../application/ports";

export interface SupabaseAdminConfig {
  /** The project URL (NEXT_PUBLIC_SUPABASE_URL). */
  url: string;
  /** The project's secret key (SUPABASE_SECRET_KEY): server only, never in a NEXT_PUBLIC_ variable. */
  secretKey: string;
  /** Test seam: the fetch the client uses. Tests pass a fake; nothing in a test reaches a real project. */
  fetch?: typeof fetch;
}

const TAKEN = new Set(["email_exists", "user_already_exists", "identity_already_exists", "conflict"]);
const REJECTED = new Set(["weak_password", "validation_failed", "email_address_invalid", "email_address_not_authorized", "bad_json"]);

/**
 * IdentityProvider on Supabase Auth's Admin API, with the secret key. Server-only: it is built
 * in the composition root (src/app, scripts/) from the validated environment and never reaches a
 * browser bundle. It creates confirmed users (`email_confirm: true`), so Supabase sends no
 * confirmation or invitation email; the login address is on a domain that cannot receive mail.
 */
export function supabaseIdentityProvider(config: SupabaseAdminConfig): IdentityProvider {
  const client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: config.fetch ? { fetch: config.fetch } : undefined,
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

    async deleteLogin(authUserId) {
      const { error } = await admin.deleteUser(authUserId);
      if (error) throw new Error(`Supabase Auth refused to delete a user (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
    },

    async hasVerifiedAuthenticator(authUserId) {
      const { data, error } = await admin.mfa.listFactors({ userId: authUserId });
      if (error) throw new Error(`Supabase Auth refused to list factors (status ${error.status ?? "unknown"}, code ${error.code ?? "none"})`);
      return data.factors.some((factor) => factor.factor_type === "totp" && factor.status === "verified");
    },
  };
}
