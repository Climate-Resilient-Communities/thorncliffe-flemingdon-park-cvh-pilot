// scripts/create-first-admin (S01.05, AD-4): IT creates the first Admin, once, in production.
// Run it through the launcher scripts/create-first-admin, which bundles it with esbuild:
//
//   node --env-file=.env.production.local scripts/create-first-admin \
//     --username jdoe --first-name Jane --last-name Doe --email jane.doe@example.org
//
// It needs production's environment (VERCEL_ENV=production and the rest of what
// src/platform/config/env.ts requires there, for example from
// `vercel env pull --environment=production .env.production.local`). It writes with the app's own
// database connection (DATABASE_URL, cvh_app_login) and creates the sign-in in Supabase Auth with
// the secret key (SUPABASE_SECRET_KEY). Nothing is sent to the new Admin: the script prints the
// username and starting password for IT to hand over in person.
import { parseArgs } from "node:util";
import { englishText } from "../../src/i18n/text";
import { REFUSAL_MESSAGE_KEYS, createIdentity, supabaseIdentityProvider, type AccountService } from "../../src/modules/identity";
import { EnvError, parseEnv, type Env } from "../../src/platform/config/env";
import { createDb } from "../../src/platform/db";

export interface Connection {
  identity: AccountService;
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
  "--username <username> --first-name <first name> --last-name <last name> --email <email>\n\n" +
  "The environment checks only stop a run from the wrong place. The real guard is the database: the\n" +
  "script refuses when an Admin exists or the bootstrap row exists, checked under the accounts\n" +
  "advisory lock, so running it twice, or at the same time, creates one Admin.\n\n" +
  "If a run failed part-way and the username is reported as taken although no account exists,\n" +
  "run the same command again: a sign-in left behind in Supabase Auth with no staff account, made\n" +
  "by this app, is removed automatically (when it is over 5 minutes old) and the account is created.\n" +
  "Nothing needs deleting by hand in the Supabase dashboard.";

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
  // parseEnv requires all three in production.
  const db = createDb(env.databaseUrl as string);
  const idp = supabaseIdentityProvider({ url: env.supabaseUrl as string, secretKey: env.supabaseSecretKey as string });
  return { identity: createIdentity({ db, idp }), close: () => db.$client.end({ timeout: 5 }) };
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
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const missing = ["username", "first-name", "last-name", "email"].filter((name) => typeof values[name] !== "string");
  if (missing.length > 0) {
    deps.error(`Missing ${missing.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
    return 2;
  }

  const environment = productionEnvironment(deps.env);
  if (!environment.ok) {
    deps.error(`Refusing to run: unsafe or incomplete environment settings:\n${environment.problems.map((p) => `  - ${p}`).join("\n")}`);
    return 1;
  }

  const connection = (deps.connect ?? connectToProduction)(environment.env);
  try {
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
