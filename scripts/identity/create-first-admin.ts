// scripts/create-first-admin (S01.05, AD-4): IT creates the first Admin, once, in production.
// Run it through the launcher scripts/create-first-admin, which bundles it with esbuild:
//
//   node --env-file=.env.production.local scripts/create-first-admin \
//     --username jdoe --first-name Jane --last-name Doe --email jane.doe@example.org
//
// and, if the first Admin's starting password expired (or was used without being replaced) before
// bootstrap finished, so that no Admin can sign in to re-issue it:
//
//   node --env-file=.env.production.local scripts/create-first-admin --reissue --username jdoe
//
// It needs production's environment (VERCEL_ENV=production and the rest of what
// src/platform/config/env.ts requires there, for example from
// `vercel env pull --environment=production .env.production.local`). It writes with the app's own
// database connection (DATABASE_URL, cvh_app_login) and creates the sign-in in Supabase Auth with
// the secret key (SUPABASE_SECRET_KEY), peppered with STAFF_PASSWORD_PEPPER. Nothing is sent to the
// new Admin: the script prints the username and starting password for IT to hand over in person.
import { parseArgs } from "node:util";
import { englishText } from "../../src/i18n/text";
import {
  PEPPER_NOT_CONFIGURED_MESSAGE,
  REFUSAL_MESSAGE_KEYS,
  createIdentity,
  createStaffAuth,
  supabaseIdentityProvider,
  throttleKeyFromSecret,
  type AccountService,
  type FirstAdminReissueError,
  type StaffAuthService,
} from "../../src/modules/identity";
import { EnvError, parseEnv, type Env } from "../../src/platform/config/env";
import { createDb } from "../../src/platform/db";

export interface Connection {
  identity: AccountService;
  staffAuth: Pick<StaffAuthService, "reissueFirstAdminStartingPassword">;
  close: () => Promise<void>;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  error: (line: string) => void;
  /** Test seam: wires the identity service for a production environment (a test database and a fake identity provider in tests). */
  connect?: (env: Env) => Connection;
}

const USAGE =
  "Usage: node --env-file=<production env file> scripts/create-first-admin " +
  "--username <username> --first-name <first name> --last-name <last name> --email <email>\n" +
  "       node --env-file=<production env file> scripts/create-first-admin --reissue --username <username>\n\n" +
  "The environment checks only stop a run from the wrong place. The real guard is the database: the\n" +
  "script refuses when an Admin exists or the bootstrap row exists, checked under the accounts\n" +
  "advisory lock, so running it twice, or at the same time, creates one Admin.\n\n" +
  "If a run failed part-way and the username is reported as taken although no account exists,\n" +
  "run the same command again: a sign-in left behind in Supabase Auth with no staff account, made\n" +
  "by this app, is removed automatically (when it is over 5 minutes old) and the account is created.\n" +
  "Nothing needs deleting by hand in the Supabase dashboard.\n\n" +
  "--reissue: when the first Admin's starting password expired, or was used without being replaced,\n" +
  "before the two Admins finished setting up, nobody can sign in to re-issue it. This issues it again\n" +
  "(a new 24-hour window), ends every session of that account and prints it once. It is refused unless\n" +
  "setup is still in progress and the username is the first Admin's, still on a starting password.\n\n" +
  "Passwords: Supabase Auth stores hex(HMAC-SHA-256(STAFF_PASSWORD_PEPPER, password)), never the\n" +
  "password itself, so the script refuses to run without STAFF_PASSWORD_PEPPER (at least 32 random\n" +
  "bytes, for example `openssl rand -hex 32`). Rotating the pepper makes every staff password stop\n" +
  "working: after a rotation every password must be re-issued (this script for the first Admin during\n" +
  "setup; otherwise an Admin's re-issue or reset). Logins created before the pepper existed must be\n" +
  "re-issued too (none exist in production).";

/** What IT reads for each refusal of --reissue. */
const REISSUE_REFUSALS: Record<FirstAdminReissueError, string> = {
  bootstrap_not_in_progress: "setup of the first two Admins is not in progress (no first Admin yet, or both are set up); an Admin re-issues starting passwords",
  not_first_admin: "that username is not the first Admin's",
  not_reissuable: "the first Admin already chose their own password, or the account is suspended or removed",
  provider_error: "Supabase Auth did not take the new starting password; nothing changed. Try again",
  passwords_not_configured: PEPPER_NOT_CONFIGURED_MESSAGE,
};

/**
 * The environment rules of S01.02 (src/platform/config/env.ts), and production only: the first
 * Admin is created once, in the one production project, never from a preview or a laptop's
 * development settings.
 */
export function productionEnvironment(source: Record<string, string | undefined>): { ok: true; env: Env } | { ok: false; problems: string[] } {
  let env: Env;
  try {
    env = parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return { ok: false, problems: error.problems };
    throw error;
  }
  if (env.environment !== "production") {
    return {
      ok: false,
      problems: [`VERCEL_ENV: create-first-admin runs only in production (VERCEL_ENV=production), not in ${env.environment}`],
    };
  }
  return { ok: true, env };
}

function connectToProduction(env: Env): Connection {
  // parseEnv requires all three in production; the caller checked the pepper.
  const db = createDb(env.databaseUrl as string);
  const secretKey = env.supabaseSecretKey as string;
  const idp = supabaseIdentityProvider({ url: env.supabaseUrl as string, secretKey });
  const wiring = { db, idp, throttleKey: throttleKeyFromSecret(secretKey), passwordPepper: env.staffPasswordPepper };
  const identity = createIdentity(wiring);
  return { identity, staffAuth: createStaffAuth({ ...wiring, accounts: identity }), close: () => db.$client.end({ timeout: 5 }) };
}

export async function runCreateFirstAdmin(argv: string[], deps: CliDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        username: { type: "string" },
        "first-name": { type: "string" },
        "last-name": { type: "string" },
        email: { type: "string" },
        reissue: { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const reissue = values.reissue === true;
  const needed = reissue ? ["username"] : ["username", "first-name", "last-name", "email"];
  const missing = needed.filter((name) => typeof values[name] !== "string");
  if (missing.length > 0) {
    deps.error(`Missing ${missing.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
    return 2;
  }
  const extra = reissue ? ["first-name", "last-name", "email"].filter((name) => values[name] !== undefined) : [];
  if (extra.length > 0) {
    deps.error(`--reissue takes only --username, not ${extra.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
    return 2;
  }

  const environment = productionEnvironment(deps.env);
  if (!environment.ok) {
    deps.error(`Refusing to run: unsafe or incomplete environment settings:\n${environment.problems.map((p) => `  - ${p}`).join("\n")}`);
    return 1;
  }
  if (environment.env.staffPasswordPepper === undefined) {
    deps.error(`Refusing to run: ${PEPPER_NOT_CONFIGURED_MESSAGE} (${environment.env.staffPasswordPepperProblem ?? "STAFF_PASSWORD_PEPPER"}).`);
    return 1;
  }

  const connection = (deps.connect ?? connectToProduction)(environment.env);
  try {
    if (reissue) {
      const result = await connection.staffAuth.reissueFirstAdminStartingPassword(String(values.username));
      if (!result.ok) {
        deps.error(`Refused: ${REISSUE_REFUSALS[result.error]} (${result.error})`);
        return 1;
      }
      deps.out(
        [
          englishText("staff.reissue.done", { username: result.value.username, password: result.value.startingPassword }),
          englishText("staff.reissue.doneLine"),
          "Every earlier session of this account has ended.",
        ].join("\n"),
      );
      return 0;
    }
    const result = await connection.identity.createFirstAdmin({
      username: String(values.username),
      firstName: String(values["first-name"]),
      lastName: String(values["last-name"]),
      email: String(values.email),
    });
    if (!result.ok) {
      deps.error(`Refused: ${englishText(REFUSAL_MESSAGE_KEYS[result.error])} (${result.error})`);
      return 1;
    }
    const { username, startingPassword } = result.value;
    deps.out(
      [
        englishText("staff.people.created", { name: `${String(values["first-name"]).trim()} ${String(values["last-name"]).trim()}` }),
        englishText("staff.people.createdUsername", { username }),
        englishText("staff.people.createdPassword", { password: startingPassword }),
        englishText("staff.people.createdLine"),
        "Setup has started: until this Admin and the one second Admin they add have both chosen their own password " +
          `and enrolled an authenticator, everything else is refused ("${englishText("staff.bootstrap.incomplete")}").`,
      ].join("\n"),
    );
    return 0;
  } finally {
    await connection.close();
  }
}

/** Entry point used by the launcher, scripts/create-first-admin. */
export function main(argv: string[]): Promise<number> {
  return runCreateFirstAdmin(argv, {
    env: process.env,
    out: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
