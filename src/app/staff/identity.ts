// Composition root of the identity module for the staff surface (AD-2): the app's database
// connection (cvh_app_login) and Supabase Auth's Admin API with the secret key. Server only: the
// staff pages and server actions import it, never a client component.
import { createIdentity, supabaseIdentityProvider, type IdentityService } from "@/modules/identity";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

let service: IdentityService | undefined;

export function identity(): IdentityService {
  if (service) return service;
  const env = getEnv();
  if (!env.supabaseUrl || !env.supabaseSecretKey) {
    throw new Error("Supabase Auth is not configured: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required");
  }
  service = createIdentity({ db: getDb(), idp: supabaseIdentityProvider({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey }) });
  return service;
}
