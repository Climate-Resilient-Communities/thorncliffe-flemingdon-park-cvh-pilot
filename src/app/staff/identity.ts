// Composition root of the identity module for the staff surface (AD-2): the app's database
// connection (cvh_app_login), Supabase Auth's Admin API with the secret key, and the per-request
// session in cookies (@supabase/ssr with the publishable key). Server only: the staff pages, route
// handlers and server actions import it, never a client component.
//
// Locally (never on Vercel: the environment check refuses it there), CVH_FAKE_IDENTITY_FILE swaps
// Supabase Auth for the in-memory fake kept in that file, for the end-to-end tests.
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import {
  createIdentity,
  createStaffAuth,
  memoryIdentityProvider,
  supabaseAuthSessions,
  supabaseIdentityProvider,
  type AccountService,
  type AuthSessions,
  type AuthSessionsFactory,
  type CookieJar,
  type StaffAuthService,
} from "@/modules/identity";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

interface Composition {
  accounts: AccountService;
  auth: StaffAuthService;
  sessions: AuthSessionsFactory;
}

let composition: Composition | undefined;

/**
 * The throttle's hash key, derived from the server-only Supabase secret key (HMAC with a fixed
 * label), so no new secret is needed and the key never leaves the server. Rotating the secret key
 * only forgets current sign-in failures and locks.
 */
function throttleKeyFrom(secret: string): string {
  return createHmac("sha256", secret).update("cvh:sign-in-throttle:v1").digest("hex");
}

/** True when this environment can sign staff in. Without it nobody is signed in (fail closed). */
export function identityConfigured(): boolean {
  const env = getEnv();
  return env.fakeIdentityFile !== undefined || (env.supabaseUrl !== undefined && env.supabaseSecretKey !== undefined && env.supabasePublishableKey !== undefined);
}

function compose(): Composition {
  if (composition) return composition;
  const env = getEnv();
  const db = getDb();
  if (env.fakeIdentityFile) {
    const fake = memoryIdentityProvider({ file: env.fakeIdentityFile });
    const throttleKey = throttleKeyFrom(`local-fake:${env.fakeIdentityFile}`);
    const accounts = createIdentity({ db, idp: fake, throttleKey });
    composition = { accounts, auth: createStaffAuth({ db, idp: fake, throttleKey, accounts }), sessions: (jar) => fake.sessions(jar) };
    return composition;
  }
  const { supabaseUrl, supabaseSecretKey, supabasePublishableKey } = env;
  if (!supabaseUrl || !supabaseSecretKey || !supabasePublishableKey) {
    throw new Error(
      "Supabase Auth is not configured: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required",
    );
  }
  const idp = supabaseIdentityProvider({ url: supabaseUrl, secretKey: supabaseSecretKey });
  const throttleKey = throttleKeyFrom(supabaseSecretKey);
  const accounts = createIdentity({ db, idp, throttleKey });
  const secureCookies = env.publicBaseUrl.startsWith("https:");
  composition = {
    accounts,
    auth: createStaffAuth({ db, idp, throttleKey, accounts }),
    sessions: (jar) => supabaseAuthSessions({ url: supabaseUrl, publishableKey: supabasePublishableKey, secureCookies }, jar),
  };
  return composition;
}

/** The account use cases (S01.05). */
export function identity(): AccountService {
  return compose().accounts;
}

/** Sign-in, the session lookup, the password change and re-issue (S01.07). */
export function staffAuth(): StaffAuthService {
  return compose().auth;
}

/**
 * The session of the current request, on its cookies. In a page render cookies cannot be written,
 * so writes are dropped there; the proxy (src/proxy.ts) has already refreshed the session.
 */
export async function requestAuthSessions(): Promise<AuthSessions> {
  const store = await cookies();
  const jar: CookieJar = {
    getAll: () => store.getAll().map(({ name, value }) => ({ name, value })),
    setAll: (list) => {
      for (const { name, value, options } of list) {
        try {
          store.set(name, value, options);
        } catch {
          // A page render: cookies are read-only there.
        }
      }
    },
  };
  return compose().sessions(jar);
}

/** Test seam: forget the composition. */
export function resetIdentityComposition(): void {
  composition = undefined;
}
