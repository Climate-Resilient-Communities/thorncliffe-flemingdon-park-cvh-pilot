// Composition root of the identity module for the staff surface (AD-2): the app's database
// connection (cvh_app_login), Supabase Auth's Admin API with the secret key, and the per-request
// session in cookies (@supabase/ssr with the publishable key). Server only: the staff pages, route
// handlers and server actions import it, never a client component.
//
// Locally (never on Vercel: the environment check refuses it there), CVH_FAKE_IDENTITY_FILE swaps
// Supabase Auth for the in-memory fake kept in that file, for the end-to-end tests.
import { cookies } from "next/headers";
import {
  createIdentity,
  createStaffAuth,
  memoryIdentityProvider,
  supabaseAuthSessions,
  supabaseIdentityProvider,
  throttleKeyFromSecret,
  type IdentityService,
  type AuthSessions,
  type AuthSessionsFactory,
  type CookieJar,
  type StaffAuthService,
} from "@/modules/identity";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";

interface Composition {
  accounts: IdentityService;
  auth: StaffAuthService;
  sessions: AuthSessionsFactory;
}

let composition: Composition | undefined;

/**
 * True when this environment can sign staff in. Without it nobody is signed in (fail closed).
 * STAFF_PASSWORD_PEPPER is not part of it: without the pepper the routes still answer, and every
 * sign-in, account creation, password change and re-issue refuses (and is logged) in the module.
 */
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
    const throttleKey = throttleKeyFromSecret(`local-fake:${env.fakeIdentityFile}`);
    const wiring = { db, idp: fake, throttleKey, passwordPepper: env.staffPasswordPepper };
    const accounts = createIdentity(wiring);
    composition = { accounts, auth: createStaffAuth({ ...wiring, accounts }), sessions: (jar) => fake.sessions(jar) };
    return composition;
  }
  const { supabaseUrl, supabaseSecretKey, supabasePublishableKey } = env;
  if (!supabaseUrl || !supabaseSecretKey || !supabasePublishableKey) {
    throw new Error(
      "Supabase Auth is not configured: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required",
    );
  }
  const idp = supabaseIdentityProvider({ url: supabaseUrl, secretKey: supabaseSecretKey });
  const wiring = { db, idp, throttleKey: throttleKeyFromSecret(supabaseSecretKey), passwordPepper: env.staffPasswordPepper };
  const accounts = createIdentity(wiring);
  const secureCookies = env.publicBaseUrl.startsWith("https:");
  composition = {
    accounts,
    auth: createStaffAuth({ ...wiring, accounts }),
    sessions: (jar) => supabaseAuthSessions({ url: supabaseUrl, publishableKey: supabasePublishableKey, secureCookies }, jar),
  };
  return composition;
}

/** The account use cases (S01.05) and changes under the two-Admin rule (S01.06). */
export function identity(): IdentityService {
  return compose().accounts;
}

/** Sign-in, the session lookup, the password change and re-issue (S01.07). */
export function staffAuth(): StaffAuthService {
  return compose().auth;
}

/**
 * The session of the current request, on its cookies. Route handlers and server actions can write
 * cookies (a sign-in sets the session cookie, a rejected session clears it); a page render cannot,
 * so writes are dropped there. Nothing refreshes the session: the proxy (src/proxy.ts) skips
 * /staff and /api, and the access token lasts the whole 12-hour session
 * (src/modules/identity/adapters/supabaseAuthSessions.ts).
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
