// scripts/recover-admin (S01.11, AD-4): IT resets one Admin's authenticator when no usable Admin can
// sign in to do it from the Hub. Run it through the launcher scripts/recover-admin, which bundles
// it with esbuild:
//
//   node --env-file=.env.production.local scripts/recover-admin \
//     --username jdoe --reason all_admins_lost_access
//
// It needs production's environment (VERCEL_ENV=production and the rest of what
// src/platform/config/env.ts requires there, for example from
// `vercel env pull --environment=production .env.production.local`), including the Supabase
// secret key (SUPABASE_SECRET_KEY) and the app's own database connection (DATABASE_URL, as
// cvh_app_login). It changes no password, so STAFF_PASSWORD_PEPPER is not needed. Nothing is sent to
// the Admin: IT tells them in person what to do next.
import { parseArgs } from "node:util";
import { FACTOR_RESET_REASONS } from "../../src/modules/audit";
import {
  createIdentity,
  supabaseIdentityProvider,
  throttleKeyFromSecret,
  type FactorResetReason,
  type FactorRecoveryService,
  type RecoverAdminError,
} from "../../src/modules/identity";
import type { Env } from "../../src/platform/config/env";
import { createDb } from "../../src/platform/db";
import { productionEnvironment } from "./create-first-admin";

export interface Connection {
  identity: Pick<FactorRecoveryService, "recoverAdmin">;
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
  "Usage: node --env-file=<production env file> scripts/recover-admin --username <admin's username> " +
  `--reason <${FACTOR_RESET_REASONS.join("|")}>\n\n` +
  "For when no usable Admin can sign in to reset an Admin's authenticator from the Hub (People, \"Reset an\n" +
  "authenticator\"). It resets the named Admin's authenticator under the same rules as the Hub: the\n" +
  "authenticator is removed, every session of that Admin ends, and at their next sign-in (with their own\n" +
  "password, which this does not change) they set up a new authenticator. The reset is audited as\n" +
  "`factor.reset` with actor `system` and the reason code you give (a fixed list, no free text):\n" +
  "  lost_device              the Admin lost their phone\n" +
  "  device_broken            the Admin's phone no longer works\n" +
  "  all_admins_lost_access   no usable Admin can sign in\n\n" +
  "The environment checks only stop a run from the wrong place. The real guard is the database: the\n" +
  "script refuses unless the account is an Admin that is active (or waiting for a starting password to be\n" +
  "re-issued) and NO OTHER usable Admin exists, counted under the Admin rows' locks. If another usable Admin\n" +
  "exists, ask them to reset it from the Hub instead (safer: this script then cannot be used to bypass an\n" +
  "Admin who can sign in). A usable Admin is active, not locked, has chosen their own password and has an\n" +
  "enrolled authenticator.\n\n" +
  "It works in any phase, including while the first two Admins are still being set up, and it never\n" +
  "restarts that setup. When the reset leaves fewer than two usable Admins, the Hub shows the shortfall\n" +
  "banner to the Admin once they are back: they restore a second usable Admin.";

/** What IT reads for each refusal. */
const REFUSALS: Record<RecoverAdminError, string> = {
  not_found: "no account has that username",
  not_admin: "that account is not an Admin; an Admin resets Coordinators' authenticators from the Hub (People)",
  not_resettable: "that account is suspended or removed",
  other_usable_admin:
    "another usable Admin exists. Ask an Admin to reset this authenticator from the Hub (People, \"Reset an authenticator\"). " +
    "This script is only for when no usable Admin can sign in",
};

function connectToProduction(env: Env): Connection {
  // parseEnv requires all three in production.
  const db = createDb(env.databaseUrl as string);
  const secretKey = env.supabaseSecretKey as string;
  const idp = supabaseIdentityProvider({ url: env.supabaseUrl as string, secretKey });
  const identity = createIdentity({ db, idp, throttleKey: throttleKeyFromSecret(secretKey), passwordPepper: env.staffPasswordPepper });
  return { identity, close: () => db.$client.end({ timeout: 5 }) };
}

const isReason = (value: string): value is FactorResetReason => (FACTOR_RESET_REASONS as readonly string[]).includes(value);

export async function runRecoverAdmin(argv: string[], deps: CliDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { username: { type: "string" }, reason: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const missing = ["username", "reason"].filter((name) => typeof values[name] !== "string");
  if (missing.length > 0) {
    deps.error(`Missing ${missing.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
    return 2;
  }
  const reason = String(values.reason);
  if (!isReason(reason)) {
    deps.error(`--reason must be one of ${FACTOR_RESET_REASONS.join(", ")}, not "${reason.slice(0, 40)}"\n${USAGE}`);
    return 2;
  }

  const environment = productionEnvironment(deps.env, "recover-admin");
  if (!environment.ok) {
    deps.error(`Refusing to run: unsafe or incomplete environment settings:\n${environment.problems.map((p) => `  - ${p}`).join("\n")}`);
    return 1;
  }

  const connection = (deps.connect ?? connectToProduction)(environment.env);
  try {
    const result = await connection.identity.recoverAdmin(String(values.username), reason);
    if (!result.ok) {
      deps.error(`Refused: ${REFUSALS[result.error]} (${result.error}). Nothing was changed; the refusal is in the audit trail.`);
      return 1;
    }
    const { username, adminShortfall, providerCleared } = result.value;
    const lines = [
      `Authenticator reset for ${username}. Their old authenticator is removed and every session of theirs has ended.`,
      `Audited as factor.reset, actor system, reason ${reason}.`,
      `Next step: ${username} signs in with their own password and is taken to set up a new authenticator before anything else. This did not change their password.`,
    ];
    if (adminShortfall) {
      lines.push(
        "There are now fewer than two usable Admins. Once back in, they should restore a second usable Admin (the Hub shows the banner until two are usable).",
      );
    }
    if (!providerCleared) {
      lines.push("Supabase Auth did not delete the old authenticator just now. It no longer counts in CVH Hub and is removed when they set up the new one.");
    }
    deps.out(lines.join("\n"));
    return 0;
  } finally {
    await connection.close();
  }
}

/** Entry point used by the launcher, scripts/recover-admin. */
export function main(argv: string[]): Promise<number> {
  return runRecoverAdmin(argv, {
    env: process.env,
    out: (line) => console.log(line),
    error: (line) => console.error(line),
  });
}
